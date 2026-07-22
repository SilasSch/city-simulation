import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CONNECTION_ESTABLISHED_EVENT_TYPE,
  PROTOCOL_VERSION,
  ConnectionEstablishedPayload,
  ProtocolMessage,
  createMessage,
} from '@city/game-protocol';

/**
 * Fachlich neutrale Anwendungslogik für Echtzeitnachrichten.
 * Das Gateway validiert und delegiert — die Entscheidung, was mit einer
 * gültigen Nachricht geschieht, liegt hier.
 */
@Injectable()
export class RealtimeMessageService {
  handleConnect(): ProtocolMessage<ConnectionEstablishedPayload> {
    // Die Verbindung ist serverseitig bestätigt — ein Event, kein Command.
    return createMessage(CONNECTION_ESTABLISHED_EVENT_TYPE, {
      connectionId: randomUUID(),
      protocolVersion: PROTOCOL_VERSION,
      serverTime: new Date().toISOString(),
    });
  }
}
