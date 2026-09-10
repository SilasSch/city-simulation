import { z } from 'zod';
import type { HealthResponseDto } from '@city/shared-types';

/**
 * Aktuelle Protokollversion. Zentral definiert — Client und Server
 * MÜSSEN dieselbe Version verwenden. Bei Erhöhung ist ADR 0006 zu beachten.
 */
export const PROTOCOL_VERSION = 3;

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
  // Fachliche Fehlercodes (Auth + Character). Werden über REST und
  // WebSocket konsistent verwendet.
  'AUTHENTICATION_REQUIRED',
  'INVALID_CREDENTIALS',
  'RATE_LIMITED',
  'SESSION_EXPIRED',
  'ORIGIN_NOT_ALLOWED',
  'EMAIL_ALREADY_TAKEN',
  'CHARACTER_NAME_INVALID',
  'CHARACTER_NOT_FOUND',
  'CHARACTER_NOT_OWNED',
  'NO_CHARACTER_SELECTED',
  'WORLD_NOT_ENTERED',
  'WORLD_MOVE_BLOCKED',
  'INTERACTION_OBJECT_NOT_FOUND',
  'INTERACTION_OUT_OF_RANGE',
  'INTERACTION_ALREADY_ACTIVE',
  'INSUFFICIENT_FUNDS',
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

// --- World (minimaler server-autoritärer Vertical Slice) ---

/** Genau eine Zone und ein gemeinsames Koordinatensystem für diesen Slice. */
export const WORLD_ZONE_ID = 'central-square' as const;
export const WORLD_COORDINATE_MIN = 0;
export const WORLD_COORDINATE_MAX = 100;
export const WORLD_MOVE_STEP = 5;

export const WORLD_SPAWN_POSITION = { x: 50, y: 70 } as const;

export interface WorldRectangleCollider {
  readonly id: string;
  readonly kind: 'rectangle';
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface WorldCircleCollider {
  readonly id: string;
  readonly kind: 'circle';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export type WorldCollider = WorldRectangleCollider | WorldCircleCollider;

/**
 * Gemeinsames, code-natives Kollisionsmodell der Central-Square-Karte.
 * Client und Server projizieren dieselben logischen Koordinaten; der Server
 * bleibt die Autorität darüber, ob eine Position begehbar ist.
 */
export const CENTRAL_SQUARE_COLLIDERS: readonly WorldCollider[] = [
  {
    id: 'building-north-west',
    kind: 'rectangle',
    minX: 0,
    minY: 0,
    maxX: 25,
    maxY: 20,
  },
  {
    id: 'building-north-east',
    kind: 'rectangle',
    minX: 75,
    minY: 0,
    maxX: 100,
    maxY: 20,
  },
  {
    id: 'building-south-west',
    kind: 'rectangle',
    minX: 0,
    minY: 80,
    maxX: 25,
    maxY: 100,
  },
  {
    id: 'building-south-east',
    kind: 'rectangle',
    minX: 75,
    minY: 80,
    maxX: 100,
    maxY: 100,
  },
  {
    id: 'central-fountain',
    kind: 'circle',
    x: 50,
    y: 50,
    radius: 8,
  },
] as const;

export const WORLD_INTERACTION_OBJECTS = [
  {
    id: 'bench-south',
    kind: 'bench',
    x: 62,
    y: 70,
    interactionRange: 10,
    durationSimulationSeconds: 300,
    energyGain: 30,
    moneyGain: 0,
    price: 0,
  },
  {
    id: 'kiosk-north',
    kind: 'kiosk',
    x: 40,
    y: 42,
    interactionRange: 10,
    durationSimulationSeconds: 180,
    energyGain: 0,
    moneyGain: 25,
    price: 0,
  },
  {
    id: 'snack-east',
    kind: 'shop',
    x: 68,
    y: 55,
    interactionRange: 10,
    durationSimulationSeconds: 0,
    energyGain: 20,
    moneyGain: 0,
    price: 15,
  },
] as const;
export type WorldInteractionObject = (typeof WORLD_INTERACTION_OBJECTS)[number];
export type WorldInteractionObjectId = WorldInteractionObject['id'];

export function worldInteractionObject(
  id: WorldInteractionObjectId,
): WorldInteractionObject {
  const object = WORLD_INTERACTION_OBJECTS.find(
    (candidate) => candidate.id === id,
  );
  if (!object) {
    throw new Error(`Unknown world interaction object: ${id}`);
  }
  return object;
}

export function isWorldPositionWalkable(x: number, y: number): boolean {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < WORLD_COORDINATE_MIN ||
    x > WORLD_COORDINATE_MAX ||
    y < WORLD_COORDINATE_MIN ||
    y > WORLD_COORDINATE_MAX
  ) {
    return false;
  }

  return CENTRAL_SQUARE_COLLIDERS.every((collider) => {
    if (collider.kind === 'rectangle') {
      return !(
        x >= collider.minX &&
        x <= collider.maxX &&
        y >= collider.minY &&
        y <= collider.maxY
      );
    }

    const dx = x - collider.x;
    const dy = y - collider.y;
    return dx * dx + dy * dy > collider.radius * collider.radius;
  });
}

export const worldZoneIdSchema = z.literal(WORLD_ZONE_ID);
export type WorldZoneId = z.infer<typeof worldZoneIdSchema>;

export const worldDirectionSchema = z.enum(['N', 'E', 'S', 'W']);
export type WorldDirection = z.infer<typeof worldDirectionSchema>;

export const worldInteractionStateSchema = z.object({
  objectId: z.enum(['bench-south', 'kiosk-north', 'snack-east']),
  startedAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  progress: z.number().min(0).max(1),
});
export type WorldInteractionState = z.infer<typeof worldInteractionStateSchema>;

/** Non-negative integer currency on a character. Server is the only writer. */
export const CHARACTER_MONEY_MIN = 0;
export const CHARACTER_MONEY_START = 0;

export const WORLD_ENTITY_KINDS = ['character', 'npc'] as const;
export const worldEntityKindSchema = z.enum(WORLD_ENTITY_KINDS);
export type WorldEntityKind = z.infer<typeof worldEntityKindSchema>;

export const worldEntitySchema = z.object({
  characterId: z.string().uuid(),
  /** Player characters default when omitted (additive protocol field). */
  kind: worldEntityKindSchema.default('character'),
  name: z.string().min(1).max(32),
  x: z.number().int().min(WORLD_COORDINATE_MIN).max(WORLD_COORDINATE_MAX),
  y: z.number().int().min(WORLD_COORDINATE_MIN).max(WORLD_COORDINATE_MAX),
  energy: z.number().min(0).max(100),
  money: z.number().int().min(CHARACTER_MONEY_MIN),
  interaction: worldInteractionStateSchema.nullable(),
});
export type WorldEntity = z.infer<typeof worldEntitySchema>;

/**
 * Stabile, server-seitige NPCs der Central Square. Session-Lebensdauer —
 * kein Character-Account. characterId bleibt der gemeinsame Entity-Key
 * (join/update/leave/snapshot); kind unterscheidet Spieler und NPC.
 */
export const CENTRAL_SQUARE_NPCS: readonly WorldEntity[] = [
  {
    characterId: 'a1111111-1111-4111-8111-111111111111',
    kind: 'npc',
    name: 'Nachbar',
    x: 42,
    y: 58,
    energy: 100,
    money: 0,
    interaction: null,
  },
];

export function centralSquareNpcEntities(): WorldEntity[] {
  return CENTRAL_SQUARE_NPCS.map((npc) => ({ ...npc }));
}

/**
 * Einfache Patrol-Definitionen je Central-Square-NPC (server-tick).
 * Waypoints liegen auf begehbaren Plaza-Koordinaten; Idle-Pausen in Ticks.
 */
export interface CentralSquareNpcPatrol {
  readonly characterId: string;
  readonly waypoints: readonly { readonly x: number; readonly y: number }[];
  /** Pause at each waypoint, in simulation ticks (1 Hz on the gateway). */
  readonly idleTicks: number;
  /** Integer steps toward the next waypoint per tick. */
  readonly step: number;
}

export const CENTRAL_SQUARE_NPC_PATROLS: readonly CentralSquareNpcPatrol[] = [
  {
    characterId: CENTRAL_SQUARE_NPCS[0]!.characterId,
    waypoints: [
      { x: 42, y: 58 },
      { x: 34, y: 58 },
      { x: 34, y: 70 },
      { x: 46, y: 70 },
      { x: 46, y: 58 },
    ],
    idleTicks: 3,
    step: 1,
  },
];

export function centralSquareNpcPatrol(
  characterId: string,
): CentralSquareNpcPatrol | undefined {
  return CENTRAL_SQUARE_NPC_PATROLS.find(
    (patrol) => patrol.characterId === characterId,
  );
}

/** Hängt zonenspezifische NPCs an eine Entity-Liste (idempotent nach characterId).
 * Bereits vorhandene Entities (z. B. live patrol positions) haben Vorrang vor dem Katalog.
 */
export function mergeZoneNpcEntities(
  zoneId: string,
  entities: readonly WorldEntity[],
): WorldEntity[] {
  if (zoneId !== WORLD_ZONE_ID) {
    return [...entities];
  }
  const byId = new Map(
    entities.map((entity) => [entity.characterId, entity] as const),
  );
  for (const npc of centralSquareNpcEntities()) {
    if (!byId.has(npc.characterId)) {
      byId.set(npc.characterId, npc);
    }
  }
  return [...byId.values()].sort((left, right) =>
    left.characterId.localeCompare(right.characterId),
  );
}

export const WORLD_ENTER_COMMAND_TYPE = 'world-enter';
export const worldEnterPayloadSchema = z.object({
  zoneId: worldZoneIdSchema,
});
export type WorldEnterPayload = z.infer<typeof worldEnterPayloadSchema>;

export const WORLD_MOVE_COMMAND_TYPE = 'world-move';
export const worldMovePayloadSchema = z.object({
  direction: worldDirectionSchema,
});
export type WorldMovePayload = z.infer<typeof worldMovePayloadSchema>;

export const WORLD_INTERACT_COMMAND_TYPE = 'world-interact';
export const worldInteractPayloadSchema = z.object({
  objectId: z.enum(['bench-south', 'kiosk-north', 'snack-east']),
});
export type WorldInteractPayload = z.infer<typeof worldInteractPayloadSchema>;

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

export const simulationClockPayloadSchema = z.object({
  simulatedTime: z.string().datetime({ offset: true }),
  speed: z.number().positive(),
});
export type SimulationClockPayload = z.infer<
  typeof simulationClockPayloadSchema
>;

export const WORLD_SNAPSHOT_EVENT_TYPE = 'world-snapshot';
export const worldSnapshotPayloadSchema = z.object({
  zoneId: worldZoneIdSchema,
  selfCharacterId: z.string().uuid(),
  clock: simulationClockPayloadSchema,
  entities: z.array(worldEntitySchema),
});
export type WorldSnapshotPayload = z.infer<typeof worldSnapshotPayloadSchema>;

export const WORLD_POSITION_CHANGED_EVENT_TYPE = 'world-position-changed';
export const worldPositionChangedPayloadSchema = z.object({
  entity: worldEntitySchema,
});
export type WorldPositionChangedPayload = z.infer<
  typeof worldPositionChangedPayloadSchema
>;

export const WORLD_ENTITY_JOINED_EVENT_TYPE = 'world-entity-joined';
export const worldEntityJoinedPayloadSchema = z.object({
  entity: worldEntitySchema,
});
export type WorldEntityJoinedPayload = z.infer<
  typeof worldEntityJoinedPayloadSchema
>;

export const WORLD_ENTITY_LEFT_EVENT_TYPE = 'world-entity-left';
export const worldEntityLeftPayloadSchema = z.object({
  characterId: z.string().uuid(),
});
export type WorldEntityLeftPayload = z.infer<
  typeof worldEntityLeftPayloadSchema
>;

export const WORLD_ENTITY_UPDATED_EVENT_TYPE = 'world-entity-updated';
export const worldEntityUpdatedPayloadSchema = z.object({
  entity: worldEntitySchema,
});
export type WorldEntityUpdatedPayload = z.infer<
  typeof worldEntityUpdatedPayloadSchema
>;

export const SIMULATION_CLOCK_EVENT_TYPE = 'simulation-clock';
export type SimulationClockEventPayload = SimulationClockPayload;

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
