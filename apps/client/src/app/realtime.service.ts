import { Injectable, OnDestroy, signal } from '@angular/core';
import { Socket, io } from 'socket.io-client';
import {
  CONNECTION_ESTABLISHED_EVENT_TYPE,
  CONNECT_COMMAND_TYPE,
  PROTOCOL_ERROR_EVENT_TYPE,
  PROTOCOL_VERSION,
  ProtocolErrorPayload,
  connectionEstablishedPayloadSchema,
  createMessage,
  protocolEnvelopeSchema,
  protocolErrorPayloadSchema,
} from '@city/game-protocol';

export type RealtimeConnectionState =
  'disconnected' | 'connecting' | 'connected' | 'error';

/** Socket.IO-Event-Name für Protokollnachrichten (muss zum Server passen). */
const PROTOCOL_CHANNEL = 'protocol';

/**
 * Klar abgegrenzter Echtzeit-Zugang. Sendet ausschließlich validierte
 * Commands und akzeptiert ausschließlich validierte Events aus
 * game-protocol. Enthält keine Spiel- oder Fachlogik.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  readonly connectionState = signal<RealtimeConnectionState>('disconnected');
  readonly connectionId = signal<string | null>(null);
  readonly protocolError = signal<ProtocolErrorPayload | null>(null);
  readonly lastMessageType = signal<string | null>(null);

  private socket: Socket | null = null;

  connect(clientName: string): void {
    if (this.socket) return;
    this.connectionState.set('connecting');

    this.socket = io({ transports: ['websocket'] });

    this.socket.on('connect', () => {
      this.sendConnectCommand(clientName);
    });

    this.socket.on(PROTOCOL_CHANNEL, (raw: unknown) => this.handleMessage(raw));

    this.socket.on('disconnect', () => {
      this.connectionState.set('disconnected');
      this.connectionId.set(null);
    });

    this.socket.on('connect_error', () => {
      this.connectionState.set('error');
    });
  }

  private sendConnectCommand(clientName: string): void {
    const command = createMessage(CONNECT_COMMAND_TYPE, { clientName });
    // Ausgehende Nachrichten werden ebenfalls gegen die Hülle geprüft.
    const validated = protocolEnvelopeSchema.parse(command);
    this.socket?.emit(PROTOCOL_CHANNEL, validated);
  }

  private handleMessage(raw: unknown): void {
    const envelope = protocolEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      this.connectionState.set('error');
      return;
    }

    if (envelope.data.version !== PROTOCOL_VERSION) {
      this.connectionState.set('error');
      return;
    }

    this.lastMessageType.set(envelope.data.type);

    switch (envelope.data.type) {
      case CONNECTION_ESTABLISHED_EVENT_TYPE: {
        const payload = connectionEstablishedPayloadSchema.safeParse(
          envelope.data.payload,
        );
        if (!payload.success) {
          this.connectionState.set('error');
          return;
        }
        this.connectionId.set(payload.data.connectionId);
        this.protocolError.set(null);
        this.connectionState.set('connected');
        return;
      }
      case PROTOCOL_ERROR_EVENT_TYPE: {
        const payload = protocolErrorPayloadSchema.safeParse(
          envelope.data.payload,
        );
        if (!payload.success) {
          this.connectionState.set('error');
          return;
        }
        this.protocolError.set(payload.data);
        this.connectionState.set('error');
        return;
      }
      default:
        // Unbekannte Event-Typen werden nicht still akzeptiert.
        this.connectionState.set('error');
    }
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
