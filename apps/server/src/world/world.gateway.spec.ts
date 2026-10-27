import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Socket, io as ioClient } from 'socket.io-client';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  PROTOCOL_ERROR_EVENT_TYPE,
  WORLD_ENTER_COMMAND_TYPE,
  WORLD_ENTITY_LEFT_EVENT_TYPE,
  WORLD_INPUT_COMMAND_TYPE,
  WORLD_POSITIONS_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  WORLD_TRANSITION_COMMAND_TYPE,
  MARKET_LANE_SPAWN_POSITION,
  MARKET_LANE_ZONE_ID,
  WORLD_SPAWN_POSITION,
  WORLD_ZONE_ID,
  worldZonePortal,
  type ProtocolMessage,
  createMessage,
  protocolErrorPayloadSchema,
  worldPositionsPayloadSchema,
  worldSnapshotPayloadSchema,
} from '@city/game-protocol';
import { AppModule } from '../app.module';
import { AuthService } from '../auth/auth.service';
import { SESSION_COOKIE_NAME } from '../auth/session-cookie.service';
import { configureApplication } from '../core/configure-application';
import { PrismaService } from '../persistence/prisma.service';
import { PROTOCOL_CHANNEL } from '../realtime/realtime.gateway';
import { cleanDatabase } from '../../test/test-database';

const CLIENT_ORIGIN = 'http://localhost:4200';

interface TestPlayer {
  cookie: string;
  sessionId: string;
  characterId?: string;
}

describe('World via RealtimeGateway (integration)', () => {
  let app: INestApplication;
  let auth: AuthService;
  let prisma: PrismaService;
  let port: number;
  const openSockets: Socket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
    auth = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const socket of openSockets.splice(0)) socket.disconnect();
    await cleanDatabase(prisma);
  });

  afterAll(async () => app.close());

  async function createPlayer(
    email: string,
    withCharacter = true,
  ): Promise<TestPlayer> {
    const result = await auth.register(email, 'geheim-123');
    let characterId: string | undefined;
    if (withCharacter) {
      const character = await prisma.character.create({
        data: {
          playerProfileId: result.body.playerProfileId,
          name: 'Ayla',
        },
      });
      await prisma.playerProfile.update({
        where: { id: result.body.playerProfileId },
        data: { selectedCharacterId: character.id },
      });
      characterId = character.id;
    }
    return {
      cookie: `${SESSION_COOKIE_NAME}=${result.sessionToken}`,
      sessionId: result.sessionToken,
      ...(characterId !== undefined ? { characterId } : {}),
    };
  }

  function connect(cookie: string): {
    socket: Socket;
    connected: Promise<void>;
  } {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: { Cookie: cookie, Origin: CLIENT_ORIGIN },
    });
    openSockets.push(socket);
    return {
      socket,
      connected: new Promise((resolve) => socket.once('connect', resolve)),
    };
  }

  function nextMessage(
    socket: Socket,
    expectedType?: string,
  ): Promise<ProtocolMessage<unknown>> {
    return new Promise((resolve) => {
      const listener = (message: ProtocolMessage<unknown>): void => {
        if (expectedType && message.type !== expectedType) return;
        socket.off(PROTOCOL_CHANNEL, listener);
        resolve(message);
      };
      socket.on(PROTOCOL_CHANNEL, listener);
    });
  }

  function enter(
    socket: Socket,
    zoneId: typeof WORLD_ZONE_ID | typeof MARKET_LANE_ZONE_ID = WORLD_ZONE_ID,
  ): Promise<ProtocolMessage<unknown>> {
    const response = nextMessage(socket);
    socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_ENTER_COMMAND_TYPE, { zoneId }),
    );
    return response;
  }

  it('returns NO_CHARACTER_SELECTED when the profile has no selection', async () => {
    const player = await createPlayer('empty-world@example.com', false);
    const { socket, connected } = connect(player.cookie);
    await connected;

    const response = await enter(socket);
    expect(response.type).toBe(PROTOCOL_ERROR_EVENT_TYPE);
    expect(protocolErrorPayloadSchema.parse(response.payload).code).toBe(
      'NO_CHARACTER_SELECTED',
    );
  });

  it('rejects movement before world entry without writing a position', async () => {
    const player = await createPlayer('not-entered@example.com');
    const { socket, connected } = connect(player.cookie);
    await connected;

    const responsePromise = nextMessage(socket);
    socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_INPUT_COMMAND_TYPE, { seq: 1, x: 1, y: 0 }),
    );
    const response = await responsePromise;

    expect(response.type).toBe(PROTOCOL_ERROR_EVENT_TYPE);
    expect(protocolErrorPayloadSchema.parse(response.payload).code).toBe(
      'WORLD_NOT_ENTERED',
    );
    expect(await prisma.characterWorldState.count()).toBe(0);
  });

  it('sends a snapshot, broadcasts movement and restores it on reconnect', async () => {
    const player = await createPlayer('broadcast@example.com');
    const first = connect(player.cookie);
    const second = connect(player.cookie);
    await Promise.all([first.connected, second.connected]);

    const firstSnapshot = await enter(first.socket);
    expect(firstSnapshot.type).toBe(WORLD_SNAPSHOT_EVENT_TYPE);
    const snapshot = worldSnapshotPayloadSchema.parse(firstSnapshot.payload);
    expect(snapshot.selfCharacterId).toBe(player.characterId);
    expect(snapshot.clock.speed).toBe(60);
    expect(snapshot.entities.length).toBeGreaterThanOrEqual(2);
    const self = snapshot.entities.find(
      (entity) => entity.characterId === player.characterId,
    );
    expect(self).toMatchObject({
      characterId: player.characterId,
      kind: 'character',
      name: 'Ayla',
      x: 50,
      y: 70,
      interaction: null,
    });
    expect(self?.energy).toBeGreaterThan(99);
    expect(snapshot.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'npc', name: 'Nachbar' }),
      ]),
    );
    await enter(second.socket);

    const firstEvent = nextMessage(first.socket, WORLD_POSITIONS_EVENT_TYPE);
    const secondEvent = nextMessage(second.socket, WORLD_POSITIONS_EVENT_TYPE);
    first.socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_INPUT_COMMAND_TYPE, { seq: 1, x: 1, y: 0 }),
    );

    for (const response of await Promise.all([firstEvent, secondEvent])) {
      const payload = worldPositionsPayloadSchema.parse(response.payload);
      expect(payload.zoneId).toBe(WORLD_ZONE_ID);
      const self = payload.entities.find(
        (entity) => entity.characterId === player.characterId,
      );
      expect(self?.seq).toBe(1);
      expect(self?.x).toBeGreaterThan(50);
      expect(self?.y).toBe(70);
    }

    // Stopp bestätigen lassen; die Endposition überlebt den Reconnect.
    const stopped = new Promise<{ x: number; y: number }>((resolve) => {
      const listener = (message: ProtocolMessage<unknown>): void => {
        if (message.type !== WORLD_POSITIONS_EVENT_TYPE) return;
        const self = worldPositionsPayloadSchema
          .parse(message.payload)
          .entities.find((entity) => entity.characterId === player.characterId);
        if (self?.seq !== 2) return;
        first.socket.off(PROTOCOL_CHANNEL, listener);
        resolve(self);
      };
      first.socket.on(PROTOCOL_CHANNEL, listener);
    });
    first.socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_INPUT_COMMAND_TYPE, { seq: 2, x: 0, y: 0 }),
    );
    const finalPosition = await stopped;

    first.socket.disconnect();
    const reconnected = connect(player.cookie);
    await reconnected.connected;
    const restored = worldSnapshotPayloadSchema.parse(
      (await enter(reconnected.socket)).payload,
    );
    const restoredSelf = restored.entities.find(
      (entity) => entity.characterId === player.characterId,
    );
    expect(restoredSelf?.x).toBeCloseTo(finalPosition.x);
    expect(restoredSelf?.y).toBe(70);
  });

  it('disconnects every socket immediately when its session is revoked', async () => {
    const player = await createPlayer('revoked-socket@example.com');
    const first = connect(player.cookie);
    const second = connect(player.cookie);
    await Promise.all([first.connected, second.connected]);

    const responses = [
      nextMessage(first.socket, PROTOCOL_ERROR_EVENT_TYPE),
      nextMessage(second.socket, PROTOCOL_ERROR_EVENT_TYPE),
    ];
    const disconnected = [first.socket, second.socket].map(
      (socket) =>
        new Promise<void>((resolve) =>
          socket.once('disconnect', () => resolve()),
        ),
    );
    await auth.revokeSession(player.sessionId);

    for (const response of await Promise.all(responses)) {
      expect(protocolErrorPayloadSchema.parse(response.payload).code).toBe(
        'AUTHENTICATION_REQUIRED',
      );
    }
    await Promise.all(disconnected);
    expect(first.socket.connected).toBe(false);
    expect(second.socket.connected).toBe(false);
    expect(await prisma.characterWorldState.count()).toBe(0);
  });

  it('disconnects an active socket when the fixed session expiry is reached', async () => {
    const player = await createPlayer('expiring-socket@example.com');
    await prisma.session.update({
      where: { id: player.sessionId },
      data: { expiresAt: new Date(Date.now() + 500) },
    });
    const { socket, connected } = connect(player.cookie);
    await connected;

    const responsePromise = nextMessage(socket, PROTOCOL_ERROR_EVENT_TYPE);
    const disconnected = new Promise<void>((resolve) =>
      socket.once('disconnect', () => resolve()),
    );

    const response = await responsePromise;
    expect(protocolErrorPayloadSchema.parse(response.payload).code).toBe(
      'SESSION_EXPIRED',
    );
    await disconnected;
    expect(socket.connected).toBe(false);
  });

  it('does not resolve the session again on the normal command path', async () => {
    const player = await createPlayer('lookup-free@example.com');
    const resolvePrincipal = vi.spyOn(auth, 'resolvePrincipal');
    const { socket, connected } = connect(player.cookie);
    await connected;
    expect(resolvePrincipal).toHaveBeenCalledTimes(1);

    await enter(socket);
    const moved = nextMessage(socket, WORLD_POSITIONS_EVENT_TYPE);
    socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_INPUT_COMMAND_TYPE, { seq: 1, x: 1, y: 0 }),
    );
    await moved;

    expect(resolvePrincipal).toHaveBeenCalledTimes(1);
  });

  it('enters market-lane with spawn snapshot and no NPCs', async () => {
    const player = await createPlayer('market-lane@example.com');
    const { socket, connected } = connect(player.cookie);
    await connected;

    const response = await enter(socket, MARKET_LANE_ZONE_ID);
    expect(response.type).toBe(WORLD_SNAPSHOT_EVENT_TYPE);
    const snapshot = worldSnapshotPayloadSchema.parse(response.payload);
    expect(snapshot.zoneId).toBe(MARKET_LANE_ZONE_ID);
    expect(snapshot.selfCharacterId).toBe(player.characterId);
    const self = snapshot.entities.find(
      (entity) => entity.characterId === player.characterId,
    );
    expect(self).toMatchObject({
      ...MARKET_LANE_SPAWN_POSITION,
      kind: 'character',
      name: 'Ayla',
    });
    expect(snapshot.entities.every((entity) => entity.kind !== 'npc')).toBe(
      true,
    );

    const stored = await prisma.characterWorldState.findUniqueOrThrow({
      where: { characterId: player.characterId! },
    });
    expect(stored.zoneId).toBe(MARKET_LANE_ZONE_ID);
  });

  it('transitions via portal, rejects out-of-range, and notifies peers', async () => {
    const traveler = await createPlayer('portal-traveler@example.com');
    const watcher = await createPlayer('portal-watcher@example.com');
    const a = connect(traveler.cookie);
    const b = connect(watcher.cookie);
    await Promise.all([a.connected, b.connected]);

    await enter(a.socket);
    await enter(b.socket);

    const rejectedPromise = nextMessage(a.socket, PROTOCOL_ERROR_EVENT_TYPE);
    a.socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_TRANSITION_COMMAND_TYPE, {
        portalId: 'central-square-east',
      }),
    );
    const rejected = await rejectedPromise;
    expect(protocolErrorPayloadSchema.parse(rejected.payload).code).toBe(
      'INTERACTION_OUT_OF_RANGE',
    );

    const portal = worldZonePortal('central-square-east');
    await prisma.characterWorldState.update({
      where: { characterId: traveler.characterId! },
      data: { x: portal.x, y: portal.y },
    });

    const leftPromise = nextMessage(b.socket, WORLD_ENTITY_LEFT_EVENT_TYPE);
    const snapshotPromise = nextMessage(a.socket, WORLD_SNAPSHOT_EVENT_TYPE);
    a.socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_TRANSITION_COMMAND_TYPE, {
        portalId: 'central-square-east',
      }),
    );
    const [left, snapshotMessage] = await Promise.all([
      leftPromise,
      snapshotPromise,
    ]);
    expect(left.type).toBe(WORLD_ENTITY_LEFT_EVENT_TYPE);
    expect(left.payload).toMatchObject({
      characterId: traveler.characterId,
    });

    const snapshot = worldSnapshotPayloadSchema.parse(snapshotMessage.payload);
    expect(snapshot.zoneId).toBe(MARKET_LANE_ZONE_ID);
    expect(
      snapshot.entities.find(
        (entity) => entity.characterId === traveler.characterId,
      ),
    ).toMatchObject(MARKET_LANE_SPAWN_POSITION);

    const stored = await prisma.characterWorldState.findUniqueOrThrow({
      where: { characterId: traveler.characterId! },
    });
    expect(stored).toMatchObject({
      zoneId: MARKET_LANE_ZONE_ID,
      ...MARKET_LANE_SPAWN_POSITION,
    });

    const returnPortal = worldZonePortal('market-lane-west');
    await prisma.characterWorldState.update({
      where: { characterId: traveler.characterId! },
      data: { x: returnPortal.x, y: returnPortal.y },
    });
    const backPromise = nextMessage(a.socket, WORLD_SNAPSHOT_EVENT_TYPE);
    a.socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_TRANSITION_COMMAND_TYPE, {
        portalId: 'market-lane-west',
      }),
    );
    const back = worldSnapshotPayloadSchema.parse((await backPromise).payload);
    expect(back.zoneId).toBe(WORLD_ZONE_ID);
    expect(
      back.entities.find(
        (entity) => entity.characterId === traveler.characterId,
      ),
    ).toMatchObject(WORLD_SPAWN_POSITION);
  });
});
