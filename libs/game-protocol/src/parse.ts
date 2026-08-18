import {
  CONNECTION_ESTABLISHED_EVENT_TYPE,
  CONNECT_COMMAND_TYPE,
  PROTOCOL_ERROR_EVENT_TYPE,
  PROTOCOL_VERSION,
  WORLD_ENTER_COMMAND_TYPE,
  WORLD_MOVE_COMMAND_TYPE,
  WORLD_POSITION_CHANGED_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  connectPayloadSchema,
  connectionEstablishedPayloadSchema,
  protocolEnvelopeSchema,
  protocolErrorPayloadSchema,
  worldEnterPayloadSchema,
  worldMovePayloadSchema,
  worldPositionChangedPayloadSchema,
  worldSnapshotPayloadSchema,
} from './protocol';
import type {
  ConnectPayload,
  ConnectionEstablishedPayload,
  ProtocolEnvelope,
  ProtocolErrorCode,
  ProtocolErrorPayload,
  WorldEnterPayload,
  WorldMovePayload,
  WorldPositionChangedPayload,
  WorldSnapshotPayload,
} from './protocol';

/** Erfolgreich geparste, versionierte und validierte Client-Nachricht. */
export type ParsedMessage =
  | {
      kind: typeof CONNECT_COMMAND_TYPE;
      envelope: ProtocolEnvelope;
      payload: ConnectPayload;
    }
  | {
      kind: typeof WORLD_ENTER_COMMAND_TYPE;
      envelope: ProtocolEnvelope;
      payload: WorldEnterPayload;
    }
  | {
      kind: typeof WORLD_MOVE_COMMAND_TYPE;
      envelope: ProtocolEnvelope;
      payload: WorldMovePayload;
    };

/** Erfolgreich geparstes und vollständig validiertes Serverevent. */
export type ParsedServerMessage =
  | {
      kind: typeof CONNECTION_ESTABLISHED_EVENT_TYPE;
      envelope: ProtocolEnvelope;
      payload: ConnectionEstablishedPayload;
    }
  | {
      kind: typeof PROTOCOL_ERROR_EVENT_TYPE;
      envelope: ProtocolEnvelope;
      payload: ProtocolErrorPayload;
    }
  | {
      kind: typeof WORLD_SNAPSHOT_EVENT_TYPE;
      envelope: ProtocolEnvelope;
      payload: WorldSnapshotPayload;
    }
  | {
      kind: typeof WORLD_POSITION_CHANGED_EVENT_TYPE;
      envelope: ProtocolEnvelope;
      payload: WorldPositionChangedPayload;
    };

export interface ParseFailure {
  ok: false;
  code: ProtocolErrorCode;
  message: string;
  receivedVersion?: number;
  requestId?: string;
}

export type ParseResult = ({ ok: true } & ParsedMessage) | ParseFailure;
export type ParseServerResult =
  ({ ok: true } & ParsedServerMessage) | ParseFailure;

function parseEnvelope(
  raw: unknown,
): { ok: true; envelope: ProtocolEnvelope } | ParseFailure {
  const envelopeResult = protocolEnvelopeSchema.safeParse(raw);
  if (!envelopeResult.success) {
    return {
      ok: false,
      code: 'INVALID_MESSAGE',
      message: 'Message does not match the protocol envelope schema',
    };
  }

  const envelope = envelopeResult.data;
  if (envelope.version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'UNSUPPORTED_PROTOCOL_VERSION',
      message: `Protocol version ${envelope.version} is not supported`,
      receivedVersion: envelope.version,
      requestId: envelope.requestId,
    };
  }

  return { ok: true, envelope };
}

function invalidPayload(
  envelope: ProtocolEnvelope,
  messageType: string,
): ParseFailure {
  return {
    ok: false,
    code: 'VALIDATION_ERROR',
    message: `Payload of ${messageType} is invalid`,
    requestId: envelope.requestId,
  };
}

/**
 * Validiert eine eingehende Client-Nachricht an der Netzwerkgrenze:
 * 1. Hüllen-Schema, 2. Protokollversion, 3. typ-spezifisches Payload-Schema.
 * Unbekannte Versionen und Typen werden niemals still akzeptiert.
 */
export function parseIncomingMessage(raw: unknown): ParseResult {
  const parsedEnvelope = parseEnvelope(raw);
  if (!parsedEnvelope.ok) return parsedEnvelope;
  const { envelope } = parsedEnvelope;

  switch (envelope.type) {
    case CONNECT_COMMAND_TYPE: {
      const payloadResult = connectPayloadSchema.safeParse(envelope.payload);
      if (!payloadResult.success) {
        return invalidPayload(envelope, 'connect command');
      }
      return {
        ok: true,
        kind: CONNECT_COMMAND_TYPE,
        envelope,
        payload: payloadResult.data,
      };
    }
    case WORLD_ENTER_COMMAND_TYPE: {
      const payloadResult = worldEnterPayloadSchema.safeParse(envelope.payload);
      if (!payloadResult.success) {
        return invalidPayload(envelope, 'world-enter command');
      }
      return {
        ok: true,
        kind: WORLD_ENTER_COMMAND_TYPE,
        envelope,
        payload: payloadResult.data,
      };
    }
    case WORLD_MOVE_COMMAND_TYPE: {
      const payloadResult = worldMovePayloadSchema.safeParse(envelope.payload);
      if (!payloadResult.success) {
        return invalidPayload(envelope, 'world-move command');
      }
      return {
        ok: true,
        kind: WORLD_MOVE_COMMAND_TYPE,
        envelope,
        payload: payloadResult.data,
      };
    }
    default:
      return {
        ok: false,
        code: 'INVALID_MESSAGE',
        message: `Unknown message type: ${envelope.type}`,
        requestId: envelope.requestId,
      };
  }
}

/**
 * Validiert Serverevents an der Client-Netzwerkgrenze. Der Client übernimmt
 * erst dann Zustand, wenn Hülle, Version, Typ und Payload gemeinsam stimmen.
 */
export function parseServerMessage(raw: unknown): ParseServerResult {
  const parsedEnvelope = parseEnvelope(raw);
  if (!parsedEnvelope.ok) return parsedEnvelope;
  const { envelope } = parsedEnvelope;

  switch (envelope.type) {
    case CONNECTION_ESTABLISHED_EVENT_TYPE: {
      const payloadResult = connectionEstablishedPayloadSchema.safeParse(
        envelope.payload,
      );
      if (!payloadResult.success) {
        return invalidPayload(envelope, 'connection-established event');
      }
      return {
        ok: true,
        kind: CONNECTION_ESTABLISHED_EVENT_TYPE,
        envelope,
        payload: payloadResult.data,
      };
    }
    case PROTOCOL_ERROR_EVENT_TYPE: {
      const payloadResult = protocolErrorPayloadSchema.safeParse(
        envelope.payload,
      );
      if (!payloadResult.success) {
        return invalidPayload(envelope, 'protocol-error event');
      }
      return {
        ok: true,
        kind: PROTOCOL_ERROR_EVENT_TYPE,
        envelope,
        payload: payloadResult.data,
      };
    }
    case WORLD_SNAPSHOT_EVENT_TYPE: {
      const payloadResult = worldSnapshotPayloadSchema.safeParse(
        envelope.payload,
      );
      if (!payloadResult.success) {
        return invalidPayload(envelope, 'world-snapshot event');
      }
      return {
        ok: true,
        kind: WORLD_SNAPSHOT_EVENT_TYPE,
        envelope,
        payload: payloadResult.data,
      };
    }
    case WORLD_POSITION_CHANGED_EVENT_TYPE: {
      const payloadResult = worldPositionChangedPayloadSchema.safeParse(
        envelope.payload,
      );
      if (!payloadResult.success) {
        return invalidPayload(envelope, 'world-position-changed event');
      }
      return {
        ok: true,
        kind: WORLD_POSITION_CHANGED_EVENT_TYPE,
        envelope,
        payload: payloadResult.data,
      };
    }
    default:
      return {
        ok: false,
        code: 'INVALID_MESSAGE',
        message: `Unknown message type: ${envelope.type}`,
        requestId: envelope.requestId,
      };
  }
}
