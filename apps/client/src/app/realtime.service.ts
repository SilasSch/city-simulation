import { Injectable, OnDestroy, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Socket, io } from 'socket.io-client';
import {
  CONNECTION_ESTABLISHED_EVENT_TYPE,
  CONNECT_COMMAND_TYPE,
  PROTOCOL_ERROR_EVENT_TYPE,
  WORLD_ENTER_COMMAND_TYPE,
  WORLD_MOVE_COMMAND_TYPE,
  WORLD_POSITION_CHANGED_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  connectPayloadSchema,
  createMessage,
  parseServerMessage,
  protocolEnvelopeSchema,
  worldEnterPayloadSchema,
  worldMovePayloadSchema,
} from '@city/game-protocol';
import type {
  ParsedServerMessage,
  ProtocolErrorPayload,
  WorldDirection,
  WorldZoneId,
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

  private readonly serverMessageSubject = new Subject<ParsedServerMessage>();
  readonly serverMessages: Observable<ParsedServerMessage> =
    this.serverMessageSubject.asObservable();

  private socket: Socket | null = null;

  connect(clientName: string): void {
    if (this.socket) return;
    this.protocolError.set(null);
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
    const payload = connectPayloadSchema.parse({ clientName });
    this.emitValidated(CONNECT_COMMAND_TYPE, payload);
  }

  sendWorldEnter(zoneId: WorldZoneId): void {
    if (this.connectionState() !== 'connected') return;
    const payload = worldEnterPayloadSchema.parse({ zoneId });
    this.emitValidated(WORLD_ENTER_COMMAND_TYPE, payload);
  }

  sendWorldMove(direction: WorldDirection): void {
    if (this.connectionState() !== 'connected') return;
    const payload = worldMovePayloadSchema.parse({ direction });
    this.emitValidated(WORLD_MOVE_COMMAND_TYPE, payload);
  }

  private emitValidated<TPayload>(type: string, payload: TPayload): void {
    const command = createMessage(type, payload);
    // Ausgehende Nachrichten werden ebenfalls gegen die Hülle geprüft.
    const validated = protocolEnvelopeSchema.parse(command);
    this.socket?.emit(PROTOCOL_CHANNEL, validated);
  }

  /** Netzwerkgrenze für rohe Serverevents; auch isoliert testbar. */
  handleMessage(raw: unknown): void {
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) {
      this.connectionState.set('error');
      return;
    }

    this.lastMessageType.set(parsed.kind);

    switch (parsed.kind) {
      case CONNECTION_ESTABLISHED_EVENT_TYPE:
        this.connectionId.set(parsed.payload.connectionId);
        this.protocolError.set(null);
        this.connectionState.set('connected');
        this.serverMessageSubject.next(parsed);
        return;
      case PROTOCOL_ERROR_EVENT_TYPE:
        this.protocolError.set(parsed.payload);
        // Fachliche Ablehnungen (z. B. stale World-Kontext) beenden den
        // authentifizierten Socket nicht und dürfen Folgecommands nicht blockieren.
        if (!this.connectionId()) this.connectionState.set('error');
        this.serverMessageSubject.next(parsed);
        return;
      case WORLD_SNAPSHOT_EVENT_TYPE:
      case WORLD_POSITION_CHANGED_EVENT_TYPE:
        this.serverMessageSubject.next(parsed);
        return;
    }
  }

  /** Trennt die Verbindung vollständig (z. B. nach Logout). */
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connectionState.set('disconnected');
    this.connectionId.set(null);
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.serverMessageSubject.complete();
  }
}
