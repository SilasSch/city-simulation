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
  PROTOCOL_ERROR_EVENT_TYPE,
  PROTOCOL_VERSION,
  ProtocolErrorPayload,
  createMessage,
  parseIncomingMessage,
} from '@city/game-protocol';
import { AuthService } from '../auth/auth.service';
import { SessionCookieService } from '../auth/session-cookie.service';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { RealtimeMessageService } from './realtime-message.service';

/** Socket.IO-Event-Name für alle Protokollnachrichten (beide Richtungen). */
export const PROTOCOL_CHANNEL = 'protocol';

/** Socket-Daten nach erfolgreicher Handshake-Authentifizierung. */
interface SocketData {
  principal: AuthenticatedPrincipal;
}

/**
 * Transport-Schicht für WebSockets. Validiert eingehende Nachrichten mit den
 * Zod-Schemas aus game-protocol und delegiert fachliche Behandlung an den
 * RealtimeMessageService. Enthält selbst keine Geschäftslogik.
 *
 * Authentifizierung (ADR 0007): Der Socket.IO-Handshake prüft das
 * Session-Cookie. Ohne gültige Session wird die Verbindung abgelehnt —
 * fachliche Commands setzen damit immer ein AuthenticatedPrincipal voraus.
 */
@WebSocketGateway({
  cors: { origin: true },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly messages: RealtimeMessageService,
    private readonly auth: AuthService,
    private readonly sessionCookie: SessionCookieService,
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
    this.logger.log({
      event: 'client-disconnected',
      socketId: client.id,
      userId: (client.data as SocketData).principal?.userId,
    });
  }

  @SubscribeMessage(PROTOCOL_CHANNEL)
  handleProtocolMessage(client: Socket, raw: unknown): void {
    const parsed = parseIncomingMessage(raw);

    if (!parsed.ok) {
      // Abgelehnte Nachricht: klares Error-Event, kein stiller Verwurf.
      // Die Verbindung bleibt für weitere gültige Nachrichten offen (ADR 0006).
      const errorPayload: ProtocolErrorPayload = {
        code: parsed.code,
        message: parsed.message,
        supportedVersion: PROTOCOL_VERSION,
        ...(parsed.receivedVersion !== undefined
          ? { receivedVersion: parsed.receivedVersion }
          : {}),
        ...(parsed.requestId !== undefined
          ? { requestId: parsed.requestId }
          : {}),
      };
      this.logger.warn({
        event: 'message-rejected',
        code: parsed.code,
        requestId: parsed.requestId,
        socketId: client.id,
      });
      client.emit(
        PROTOCOL_CHANNEL,
        createMessage(
          PROTOCOL_ERROR_EVENT_TYPE,
          errorPayload,
          parsed.requestId,
        ),
      );
      return;
    }

    this.logger.log({
      event: 'message-accepted',
      messageType: parsed.kind,
      requestId: parsed.envelope.requestId,
      socketId: client.id,
      userId: (client.data as SocketData).principal.userId,
    });

    const response = this.messages.handleConnect();
    client.emit(PROTOCOL_CHANNEL, {
      ...response,
      ...(parsed.envelope.requestId !== undefined
        ? { requestId: parsed.envelope.requestId }
        : {}),
    });
  }
}
