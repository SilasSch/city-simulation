import {
  CONNECT_COMMAND_TYPE,
  PROTOCOL_VERSION,
  ProtocolEnvelope,
  ProtocolErrorCode,
  connectPayloadSchema,
  ConnectPayload,
  protocolEnvelopeSchema,
} from './protocol';

/** Erfolgreich geparste, versionierte und validierte Nachricht. */
export type ParsedMessage = {
  kind: typeof CONNECT_COMMAND_TYPE;
  envelope: ProtocolEnvelope;
  payload: ConnectPayload;
};

export interface ParseFailure {
  ok: false;
  code: ProtocolErrorCode;
  message: string;
  receivedVersion?: number;
  requestId?: string;
}

export type ParseResult = ({ ok: true } & ParsedMessage) | ParseFailure;

/**
 * Validiert eine eingehende Roh-Nachricht an der Netzwerkgrenze:
 * 1. Hüllen-Schema, 2. Protokollversion, 3. typ-spezifisches Payload-Schema.
 * Unbekannte Versionen und Typen werden niemals still akzeptiert.
 */
export function parseIncomingMessage(raw: unknown): ParseResult {
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

  switch (envelope.type) {
    case CONNECT_COMMAND_TYPE: {
      const payloadResult = connectPayloadSchema.safeParse(envelope.payload);
      if (!payloadResult.success) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Payload of connect command is invalid',
          requestId: envelope.requestId,
        };
      }
      return {
        ok: true,
        kind: CONNECT_COMMAND_TYPE,
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
