import { z } from 'zod';
import type { HealthResponseDto } from '@city/shared-types';

/**
 * Aktuelle Protokollversion. Zentral definiert — Client und Server
 * MÜSSEN dieselbe Version verwenden. Bei Erhöhung ist ADR 0006 zu beachten.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Stabile maschinenlesbare Fehlercodes für ProtocolErrorEvent.
 * Nach außen sichtbarer Vertrag — nur erweitern, niemals umbenennen.
 */
export const PROTOCOL_ERROR_CODES = [
  'UNSUPPORTED_PROTOCOL_VERSION',
  'INVALID_MESSAGE',
  'VALIDATION_ERROR',
  'PERSISTENCE_ERROR',
  'UNEXPECTED_ERROR',
] as const;

export const protocolErrorCodeSchema = z.enum(PROTOCOL_ERROR_CODES);
export type ProtocolErrorCode = z.infer<typeof protocolErrorCodeSchema>;

/**
 * Einheitliche versionierte Nachrichtenhülle für alle WebSocket-Nachrichten.
 */
export const protocolEnvelopeSchema = z.object({
  version: z.number().int().positive(),
  type: z.string().min(1),
  requestId: z.string().uuid().optional(),
  timestamp: z.string().datetime({ offset: true }),
  payload: z.unknown(),
});
export type ProtocolEnvelope = z.infer<typeof protocolEnvelopeSchema>;

// --- Commands (Client -> Server): Aktion soll ausgeführt werden ---

export const CONNECT_COMMAND_TYPE = 'connect';

export const connectPayloadSchema = z.object({
  clientName: z.string().min(1).max(64),
});
export type ConnectPayload = z.infer<typeof connectPayloadSchema>;

// --- Events (Server -> Client): Zustandsänderung ist bereits erfolgt ---

export const CONNECTION_ESTABLISHED_EVENT_TYPE = 'connection-established';

export const connectionEstablishedPayloadSchema = z.object({
  connectionId: z.string().uuid(),
  protocolVersion: z.number().int().positive(),
  serverTime: z.string().datetime({ offset: true }),
});
export type ConnectionEstablishedPayload = z.infer<
  typeof connectionEstablishedPayloadSchema
>;

// --- Error Events (Server -> Client): Nachricht wurde abgelehnt ---

export const PROTOCOL_ERROR_EVENT_TYPE = 'protocol-error';

export const protocolErrorPayloadSchema = z.object({
  code: protocolErrorCodeSchema,
  message: z.string().min(1),
  supportedVersion: z.number().int().positive().optional(),
  receivedVersion: z.number().int().positive().optional(),
  requestId: z.string().uuid().optional(),
});
export type ProtocolErrorPayload = z.infer<typeof protocolErrorPayloadSchema>;

/**
 * Zod-Schema für den REST-Health-Endpunkt (GET /api/health), damit auch
 * REST-Antworten an der Systemgrenze zur Laufzeit validiert werden können.
 * Der abgeleitete Typ wird per Compile-Check mit shared-types abgeglichen.
 */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  server: z.literal('up'),
  database: z.enum(['up', 'down']),
  timestamp: z.string().datetime({ offset: true }),
});

// Compile-Zeit-Drift-Schutz: schema und shared-types-DTO müssen übereinstimmen.
const _healthResponseDriftCheck: HealthResponseDto = {} as z.infer<
  typeof healthResponseSchema
>;
void _healthResponseDriftCheck;

/** Typisierte Hülle für eine konkrete Nachricht. */
export interface ProtocolMessage<TPayload> {
  version: number;
  type: string;
  requestId?: string;
  timestamp: string;
  payload: TPayload;
}

/**
 * Erzeugt eine validierte Nachricht. requestId ist optional und dient
 * der Korrelation von Antworten (z. B. Fehler) mit Anfragen.
 */
export function createMessage<TPayload>(
  type: string,
  payload: TPayload,
  requestId?: string,
): ProtocolMessage<TPayload> {
  return {
    version: PROTOCOL_VERSION,
    type,
    ...(requestId !== undefined ? { requestId } : {}),
    timestamp: new Date().toISOString(),
    payload,
  };
}
