import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import {
  PROTOCOL_ERROR_EVENT_TYPE,
  PROTOCOL_VERSION,
  ProtocolErrorPayload,
  createMessage,
  parseIncomingMessage,
} from '@city/game-protocol';
import { RealtimeMessageService } from './realtime-message.service';

/** Socket.IO-Event-Name für alle Protokollnachrichten (beide Richtungen). */
export const PROTOCOL_CHANNEL = 'protocol';

/**
 * Transport-Schicht für WebSockets. Validiert eingehende Nachrichten mit den
 * Zod-Schemas aus game-protocol und delegiert fachliche Behandlung an den
 * RealtimeMessageService. Enthält selbst keine Geschäftslogik.
 */
@WebSocketGateway({
  cors: { origin: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly messages: RealtimeMessageService) {}

  handleConnection(client: Socket): void {
    this.logger.log({ event: 'client-connected', socketId: client.id });
  }

  handleDisconnect(client: Socket): void {
    this.logger.log({ event: 'client-disconnected', socketId: client.id });
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
