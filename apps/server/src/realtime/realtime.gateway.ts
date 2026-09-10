import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  CONNECT_COMMAND_TYPE,
  PROTOCOL_ERROR_EVENT_TYPE,
  PROTOCOL_VERSION,
  SIMULATION_CLOCK_EVENT_TYPE,
  WORLD_ENTER_COMMAND_TYPE,
  WORLD_ENTITY_JOINED_EVENT_TYPE,
  WORLD_ENTITY_LEFT_EVENT_TYPE,
  WORLD_ENTITY_UPDATED_EVENT_TYPE,
  WORLD_INTERACT_COMMAND_TYPE,
  WORLD_INTERACT_RESULT_EVENT_TYPE,
  WORLD_MOVE_COMMAND_TYPE,
  WORLD_POSITION_CHANGED_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  type ProtocolErrorCode,
  type ProtocolErrorPayload,
  createMessage,
  parseIncomingMessage,
} from '@city/game-protocol';
import { AuthService } from '../auth/auth.service';
import { SessionCookieService } from '../auth/session-cookie.service';
import { SessionSocketRegistry } from '../auth/session-socket-registry.service';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { ApplicationError } from '../shared/application-error';
import { SimulationService } from '../simulation/simulation.service';
import { WORLD_ROOM, type EnteredWorldContext } from '../world/world.constants';
import {
  WorldPresenceService,
  type PresenceDeparture,
} from '../world/world-presence.service';
import { WorldService } from '../world/world.service';
import { RealtimeMessageService } from './realtime-message.service';

/** Socket.IO-Event-Name für alle Protokollnachrichten (beide Richtungen). */
export const PROTOCOL_CHANNEL = 'protocol';

/** Socket-Daten nach erfolgreicher Handshake-Authentifizierung. */
interface SocketData {
  principal: AuthenticatedPrincipal;
  world?: EnteredWorldContext;
}

/**
 * Transport-Schicht für WebSockets. Validiert eingehende Nachrichten mit den
 * Zod-Schemas aus game-protocol und delegiert fachliche Behandlung an die
 * zuständigen Services.
 *
 * Authentifizierung (ADR 0007): Der Socket.IO-Handshake prüft das
 * Session-Cookie. Ohne gültige Session wird die Verbindung abgelehnt —
 * fachliche Commands setzen damit immer ein AuthenticatedPrincipal voraus.
 */
@WebSocketGateway()
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private simulationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly messages: RealtimeMessageService,
    private readonly auth: AuthService,
    private readonly sessionCookie: SessionCookieService,
    private readonly socketSessions: SessionSocketRegistry,
    private readonly world: WorldService,
    private readonly presence: WorldPresenceService,
    private readonly simulation: SimulationService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const token = this.sessionCookie.readToken(
        socket.handshake.headers.cookie,
      );
      if (!token) {
        next(new Error('authentication required'));
        return;
      }

      try {
        const resolution = await this.auth.resolvePrincipal(token);
        if (resolution.status !== 'ok') {
          next(
            new Error(
              resolution.status === 'expired'
                ? 'session expired'
                : 'authentication required',
            ),
          );
          return;
        }
        (socket.data as SocketData).principal = resolution.session.principal;
        this.socketSessions.register(
          token,
          resolution.session.expiresAt,
          socket.id,
          (reason) => {
            this.emitError(
              socket,
              reason === 'expired'
                ? 'SESSION_EXPIRED'
                : 'AUTHENTICATION_REQUIRED',
              reason === 'expired'
                ? 'Session expired'
                : 'Authentication required',
            );
            socket.disconnect(true);
          },
        );
        next();
      } catch (error) {
        this.logger.error(
          'Session resolution during websocket handshake failed',
          error instanceof Error ? error.stack : String(error),
        );
        next(new Error('authentication failed'));
      }
    });
    this.simulationTimer = setInterval(() => {
      void this.broadcastSimulationTick(server);
    }, 1_000);
    this.simulationTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.simulationTimer) clearInterval(this.simulationTimer);
    this.simulationTimer = null;
  }

  handleConnection(client: Socket): void {
    this.logger.log({
      event: 'client-connected',
      socketId: client.id,
      userId: (client.data as SocketData).principal.userId,
    });
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.socketSessions.unregister(client.id);
    const departure = this.presence.leave(client.id);
    if (departure?.lastSocket) {
      await this.simulation.abortInteraction(departure.characterId);
    }
    this.announceDeparture(client, departure);
    this.logger.log({
      event: 'client-disconnected',
      socketId: client.id,
      userId: (client.data as SocketData).principal?.userId,
    });
  }

  @SubscribeMessage(PROTOCOL_CHANNEL)
  async handleProtocolMessage(client: Socket, raw: unknown): Promise<void> {
    const socketData = client.data as SocketData;
    const parsed = parseIncomingMessage(raw);

    if (!parsed.ok) {
      // Abgelehnte Nachricht: klares Error-Event, kein stiller Verwurf.
      // Die Verbindung bleibt für weitere gültige Nachrichten offen (ADR 0006).
      this.logger.warn({
        event: 'message-rejected',
        code: parsed.code,
        requestId: parsed.requestId,
        socketId: client.id,
      });
      this.emitError(
        client,
        parsed.code,
        parsed.message,
        parsed.requestId,
        parsed.receivedVersion,
      );
      return;
    }

    this.logger.log({
      event: 'message-accepted',
      messageType: parsed.kind,
      requestId: parsed.envelope.requestId,
      socketId: client.id,
      userId: socketData.principal.userId,
    });

    try {
      switch (parsed.kind) {
        case CONNECT_COMMAND_TYPE: {
          const response = this.messages.handleConnect();
          client.emit(PROTOCOL_CHANNEL, {
            ...response,
            ...(parsed.envelope.requestId !== undefined
              ? { requestId: parsed.envelope.requestId }
              : {}),
          });
          return;
        }
        case WORLD_ENTER_COMMAND_TYPE: {
          // Erst ein erfolgreicher Eintritt darf den Socket-Kontext setzen.
          // Ein fehlgeschlagener Re-Enter lässt keinen alten Kontext zurück.
          await client.leave(WORLD_ROOM);
          const departure = this.presence.leave(client.id);
          if (departure?.lastSocket) {
            await this.simulation.abortInteraction(departure.characterId);
          }
          this.announceDeparture(client, departure);
          delete socketData.world;
          const entry = await this.world.enter(
            socketData.principal,
            parsed.payload.zoneId,
          );
          const self = entry.snapshot.entities.find(
            (entity) => entity.characterId === entry.context.characterId,
          );
          if (!self) {
            throw new ApplicationError(
              'PERSISTENCE_ERROR',
              503,
              'Entered character is missing from the world snapshot',
            );
          }

          const firstSocketForCharacter = this.presence.enter(client.id, self);
          await client.join(WORLD_ROOM);
          socketData.world = entry.context;
          client.emit(
            PROTOCOL_CHANNEL,
            createMessage(
              WORLD_SNAPSHOT_EVENT_TYPE,
              {
                ...entry.snapshot,
                entities: this.presence.entities(),
              },
              parsed.envelope.requestId,
            ),
          );
          if (firstSocketForCharacter) {
            client
              .to(WORLD_ROOM)
              .emit(
                PROTOCOL_CHANNEL,
                createMessage(WORLD_ENTITY_JOINED_EVENT_TYPE, { entity: self }),
              );
          }
          return;
        }
        case WORLD_INTERACT_COMMAND_TYPE: {
          if (!socketData.world) {
            throw new ApplicationError(
              'WORLD_NOT_ENTERED',
              409,
              'Enter the world before interacting',
            );
          }
          const outcome = await this.world.interact(
            socketData.principal,
            socketData.world,
            parsed.payload,
          );
          if (outcome.kind === 'object') {
            this.presence.update(outcome.entity);
            client.nsp.to(WORLD_ROOM).emit(
              PROTOCOL_CHANNEL,
              createMessage(WORLD_ENTITY_UPDATED_EVENT_TYPE, {
                entity: outcome.entity,
              }),
            );
            return;
          }

          // NPC greet is immediate, private feedback to the requesting client.
          client.emit(
            PROTOCOL_CHANNEL,
            createMessage(
              WORLD_INTERACT_RESULT_EVENT_TYPE,
              {
                kind: 'npc-greet',
                npcCharacterId: outcome.npcCharacterId,
                npcName: outcome.npcName,
                message: outcome.message,
              },
              parsed.envelope.requestId,
            ),
          );
          return;
        }
        case WORLD_MOVE_COMMAND_TYPE: {
          if (!socketData.world) {
            throw new ApplicationError(
              'WORLD_NOT_ENTERED',
              409,
              'Enter the world before moving',
            );
          }
          const entity = await this.world.move(
            socketData.principal,
            socketData.world,
            parsed.payload.direction,
          );
          this.presence.update(entity);
          client.nsp
            .to(WORLD_ROOM)
            .emit(
              PROTOCOL_CHANNEL,
              createMessage(
                WORLD_POSITION_CHANGED_EVENT_TYPE,
                { entity },
                parsed.envelope.requestId,
              ),
            );
          return;
        }
      }
    } catch (error) {
      if (error instanceof ApplicationError) {
        if (error.code === 'WORLD_NOT_ENTERED') {
          await client.leave(WORLD_ROOM);
          const departure = this.presence.leave(client.id);
          if (departure?.lastSocket) {
            await this.simulation.abortInteraction(departure.characterId);
          }
          this.announceDeparture(client, departure);
          delete socketData.world;
        }
        this.emitError(
          client,
          error.code,
          error.message,
          parsed.envelope.requestId,
        );
        return;
      }
      this.logger.error(
        'Websocket command execution failed',
        error instanceof Error ? error.stack : String(error),
      );
      this.emitError(
        client,
        'UNEXPECTED_ERROR',
        'Command execution failed',
        parsed.envelope.requestId,
      );
    }
  }

  private async broadcastSimulationTick(server: Server): Promise<void> {
    // NPCs advance on the same 1 Hz timer even when the room is empty so
    // late joiners see a live position; broadcasts only matter with peers.
    const movedNpcs = this.presence.advanceNpcs();
    const characterIds = this.presence.characterIds();

    try {
      if (characterIds.length > 0) {
        const tick = await this.simulation.tick(characterIds);
        server
          .to(WORLD_ROOM)
          .emit(
            PROTOCOL_CHANNEL,
            createMessage(SIMULATION_CLOCK_EVENT_TYPE, tick.clock),
          );
        for (const entity of tick.entities) {
          this.presence.update(entity);
          server
            .to(WORLD_ROOM)
            .emit(
              PROTOCOL_CHANNEL,
              createMessage(WORLD_ENTITY_UPDATED_EVENT_TYPE, { entity }),
            );
        }
      }

      for (const entity of movedNpcs) {
        server
          .to(WORLD_ROOM)
          .emit(
            PROTOCOL_CHANNEL,
            createMessage(WORLD_ENTITY_UPDATED_EVENT_TYPE, { entity }),
          );
      }
    } catch (error) {
      this.logger.error(
        'Simulation tick failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private announceDeparture(
    client: Socket,
    departure: PresenceDeparture | null,
  ): void {
    if (!departure?.lastSocket) return;

    client.nsp.to(WORLD_ROOM).emit(
      PROTOCOL_CHANNEL,
      createMessage(WORLD_ENTITY_LEFT_EVENT_TYPE, {
        characterId: departure.characterId,
      }),
    );
  }

  private emitError(
    client: Socket,
    code: ProtocolErrorCode,
    message: string,
    requestId?: string,
    receivedVersion?: number,
  ): void {
    const payload: ProtocolErrorPayload = {
      code,
      message,
      supportedVersion: PROTOCOL_VERSION,
      ...(receivedVersion !== undefined ? { receivedVersion } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    };
    client.emit(
      PROTOCOL_CHANNEL,
      createMessage(PROTOCOL_ERROR_EVENT_TYPE, payload, requestId),
    );
  }
}
