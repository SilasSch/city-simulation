import { Logger } from '@nestjs/common';
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
  WORLD_ENTER_COMMAND_TYPE,
  WORLD_ENTITY_JOINED_EVENT_TYPE,
  WORLD_ENTITY_LEFT_EVENT_TYPE,
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
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { ApplicationError } from '../shared/application-error';
import { WORLD_ROOM, type EnteredWorldContext } from '../world/world.constants';
import {
  WorldPresenceService,
  type PresenceDeparture,
} from '../world/world-presence.service';
import { WorldService } from '../world/world.service';
import { RealtimeMessageService } from './realtime-message.service';

export const PROTOCOL_CHANNEL = 'protocol';

interface SocketData {
  principal: AuthenticatedPrincipal;
  world?: EnteredWorldContext;
}

@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly messages: RealtimeMessageService,
    private readonly auth: AuthService,
    private readonly sessionCookie: SessionCookieService,
    private readonly world: WorldService,
    private readonly presence: WorldPresenceService,
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
        next();
      } catch (error) {
        this.logger.error(
          'Session resolution during websocket handshake failed',
          error instanceof Error ? error.stack : String(error),
        );
        next(new Error('authentication failed'));
      }
    });
  }

  handleConnection(client: Socket): void {
    this.logger.log({
      event: 'client-connected',
      socketId: client.id,
      userId: (client.data as SocketData).principal.userId,
    });
  }

  handleDisconnect(client: Socket): void {
    const departure = this.presence.leave(client.id);
    this.announceDeparture(client, departure);
    this.logger.log({
      event: 'client-disconnected',
      socketId: client.id,
      userId: (client.data as SocketData).principal?.userId,
    });
  }

  @SubscribeMessage(PROTOCOL_CHANNEL)
  async handleProtocolMessage(client: Socket, raw: unknown): Promise<void> {
    if (!(await this.revalidateSession(client))) return;

    const socketData = client.data as SocketData;
    const parsed = parseIncomingMessage(raw);

    if (!parsed.ok) {
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
          await client.leave(WORLD_ROOM);
          this.announceDeparture(client, this.presence.leave(client.id));
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
          this.announceDeparture(client, this.presence.leave(client.id));
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

  private async revalidateSession(client: Socket): Promise<boolean> {
    const socketData = client.data as SocketData;
    try {
      const resolution = await this.auth.resolvePrincipal(
        socketData.principal.sessionId,
      );
      if (resolution.status === 'ok') {
        socketData.principal = resolution.session.principal;
        return true;
      }

      this.emitError(
        client,
        resolution.status === 'expired'
          ? 'SESSION_EXPIRED'
          : 'AUTHENTICATION_REQUIRED',
        resolution.status === 'expired'
          ? 'Session expired'
          : 'Authentication required',
      );
    } catch (error) {
      this.logger.error(
        'Session revalidation during websocket command failed',
        error instanceof Error ? error.stack : String(error),
      );
      this.emitError(client, 'UNEXPECTED_ERROR', 'Session validation failed');
    }

    client.disconnect(true);
    return false;
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
