import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Socket, io as ioClient } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PROTOCOL_ERROR_EVENT_TYPE,
  WORLD_ENTER_COMMAND_TYPE,
  WORLD_MOVE_COMMAND_TYPE,
  WORLD_POSITION_CHANGED_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  WORLD_ZONE_ID,
  type ProtocolMessage,
  createMessage,
  protocolErrorPayloadSchema,
  worldPositionChangedPayloadSchema,
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

  function enter(socket: Socket): Promise<ProtocolMessage<unknown>> {
    const response = nextMessage(socket);
    socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_ENTER_COMMAND_TYPE, { zoneId: WORLD_ZONE_ID }),
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
      createMessage(WORLD_MOVE_COMMAND_TYPE, { direction: 'E' }),
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
    expect(snapshot.entities).toHaveLength(1);
    expect(snapshot.entities[0]).toMatchObject({
      characterId: player.characterId,
      name: 'Ayla',
      x: 50,
      y: 70,
      interaction: null,
    });
    expect(snapshot.entities[0]?.energy).toBeGreaterThan(99);
    await enter(second.socket);

    const firstEvent = nextMessage(
      first.socket,
      WORLD_POSITION_CHANGED_EVENT_TYPE,
    );
    const secondEvent = nextMessage(
      second.socket,
      WORLD_POSITION_CHANGED_EVENT_TYPE,
    );
    first.socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_MOVE_COMMAND_TYPE, { direction: 'E' }),
    );

    for (const response of await Promise.all([firstEvent, secondEvent])) {
      expect(response.type).toBe(WORLD_POSITION_CHANGED_EVENT_TYPE);
      expect(
        worldPositionChangedPayloadSchema.parse(response.payload).entity,
      ).toMatchObject({
        characterId: player.characterId,
        name: 'Ayla',
        x: 55,
        y: 70,
        interaction: null,
      });
    }

    first.socket.disconnect();
    const reconnected = connect(player.cookie);
    await reconnected.connected;
    const restored = worldSnapshotPayloadSchema.parse(
      (await enter(reconnected.socket)).payload,
    );
    expect(
      restored.entities.find(
        (entity) => entity.characterId === player.characterId,
      ),
    ).toMatchObject({ x: 55, y: 70 });
  });

  it('disconnects a socket whose session was revoked before the command', async () => {
    const player = await createPlayer('revoked-socket@example.com');
    const { socket, connected } = connect(player.cookie);
    await connected;
    await prisma.session.delete({ where: { id: player.sessionId } });

    const responsePromise = nextMessage(socket);
    const disconnected = new Promise<void>((resolve) =>
      socket.once('disconnect', () => resolve()),
    );
    socket.emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_ENTER_COMMAND_TYPE, { zoneId: WORLD_ZONE_ID }),
    );

    const response = await responsePromise;
    expect(response.type).toBe(PROTOCOL_ERROR_EVENT_TYPE);
    expect(protocolErrorPayloadSchema.parse(response.payload).code).toBe(
      'AUTHENTICATION_REQUIRED',
    );
    await disconnected;
    expect(socket.connected).toBe(false);
    expect(await prisma.characterWorldState.count()).toBe(0);
  });
});
