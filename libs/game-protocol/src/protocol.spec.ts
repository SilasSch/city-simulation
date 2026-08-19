import { describe, expect, it } from 'vitest';
import {
  CONNECT_COMMAND_TYPE,
  PROTOCOL_VERSION,
  WORLD_ENTITY_JOINED_EVENT_TYPE,
  WORLD_ENTITY_LEFT_EVENT_TYPE,
  WORLD_COORDINATE_MAX,
  WORLD_ENTER_COMMAND_TYPE,
  WORLD_MOVE_COMMAND_TYPE,
  WORLD_POSITION_CHANGED_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  WORLD_ZONE_ID,
  connectionEstablishedPayloadSchema,
  connectPayloadSchema,
  createMessage,
  isWorldPositionWalkable,
  protocolEnvelopeSchema,
  worldEntitySchema,
  worldSnapshotPayloadSchema,
} from './protocol';
import { parseIncomingMessage, parseServerMessage } from './parse';

const CHARACTER_ID = '3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e';
const WORLD_ENTITY = {
  characterId: CHARACTER_ID,
  name: 'Ayla',
  x: 50,
  y: 50,
};

describe('protocol schemas', () => {
  it('accepts a valid connect command envelope', () => {
    const message = createMessage(CONNECT_COMMAND_TYPE, {
      clientName: 'test-client',
    });
    expect(protocolEnvelopeSchema.safeParse(message).success).toBe(true);
    expect(connectPayloadSchema.safeParse(message.payload).success).toBe(true);
  });

  it('rejects an envelope without version', () => {
    const message = createMessage(CONNECT_COMMAND_TYPE, {
      clientName: 'x',
    }) as Record<string, unknown>;
    delete message['version'];
    expect(protocolEnvelopeSchema.safeParse(message).success).toBe(false);
  });

  it('rejects a connect payload with empty clientName', () => {
    expect(connectPayloadSchema.safeParse({ clientName: '' }).success).toBe(
      false,
    );
  });

  it('validates a connection-established payload', () => {
    const payload = {
      connectionId: '3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e',
      protocolVersion: PROTOCOL_VERSION,
      serverTime: new Date().toISOString(),
    };
    expect(connectionEstablishedPayloadSchema.safeParse(payload).success).toBe(
      true,
    );
  });

  it('validates world entities only inside the shared zone bounds', () => {
    expect(worldEntitySchema.safeParse(WORLD_ENTITY).success).toBe(true);
    expect(
      worldEntitySchema.safeParse({
        ...WORLD_ENTITY,
        x: WORLD_COORDINATE_MAX + 1,
      }).success,
    ).toBe(false);
  });

  it('shares deterministic world bounds and obstacle rules', () => {
    expect(isWorldPositionWalkable(50, 70)).toBe(true);
    expect(isWorldPositionWalkable(-5, 50)).toBe(false);
    expect(isWorldPositionWalkable(25, 10)).toBe(false);
    expect(isWorldPositionWalkable(50, 50)).toBe(false);
  });

  it('validates complete world snapshots', () => {
    expect(
      worldSnapshotPayloadSchema.safeParse({
        zoneId: WORLD_ZONE_ID,
        selfCharacterId: CHARACTER_ID,
        entities: [WORLD_ENTITY],
      }).success,
    ).toBe(true);
  });
});

describe('parseIncomingMessage', () => {
  it('parses a valid connect command', () => {
    const message = createMessage(CONNECT_COMMAND_TYPE, {
      clientName: 'test-client',
    });
    const result = parseIncomingMessage(message);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe(CONNECT_COMMAND_TYPE);
      if (result.kind === CONNECT_COMMAND_TYPE) {
        expect(result.payload.clientName).toBe('test-client');
      }
    }
  });

  it('parses world-enter and world-move commands', () => {
    const enter = parseIncomingMessage(
      createMessage(WORLD_ENTER_COMMAND_TYPE, { zoneId: WORLD_ZONE_ID }),
    );
    const move = parseIncomingMessage(
      createMessage(WORLD_MOVE_COMMAND_TYPE, { direction: 'W' }),
    );

    expect(enter.ok && enter.kind).toBe(WORLD_ENTER_COMMAND_TYPE);
    expect(move.ok && move.kind).toBe(WORLD_MOVE_COMMAND_TYPE);
  });

  it('rejects invalid zones and movement directions', () => {
    const enter = parseIncomingMessage(
      createMessage(WORLD_ENTER_COMMAND_TYPE, { zoneId: 'other-zone' }),
    );
    const move = parseIncomingMessage(
      createMessage(WORLD_MOVE_COMMAND_TYPE, { direction: 'up' }),
    );

    expect(enter.ok).toBe(false);
    expect(move.ok).toBe(false);
    if (!enter.ok) expect(enter.code).toBe('VALIDATION_ERROR');
    if (!move.ok) expect(move.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unsupported protocol versions with the requestId attached', () => {
    const message = {
      ...createMessage(
        CONNECT_COMMAND_TYPE,
        { clientName: 'x' },
        '3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e',
      ),
      version: PROTOCOL_VERSION + 1,
    };
    const result = parseIncomingMessage(message);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNSUPPORTED_PROTOCOL_VERSION');
      expect(result.receivedVersion).toBe(PROTOCOL_VERSION + 1);
      expect(result.requestId).toBe('3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e');
    }
  });

  it('rejects malformed envelopes', () => {
    const result = parseIncomingMessage({ nope: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_MESSAGE');
  });

  it('rejects unknown message types', () => {
    const result = parseIncomingMessage(createMessage('spawn-dragon', {}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_MESSAGE');
  });

  it('rejects invalid payloads of known types', () => {
    const result = parseIncomingMessage(
      createMessage(CONNECT_COMMAND_TYPE, { clientName: '' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
  });
});

describe('parseServerMessage', () => {
  it('parses world snapshots and position changes', () => {
    const snapshot = parseServerMessage(
      createMessage(WORLD_SNAPSHOT_EVENT_TYPE, {
        zoneId: WORLD_ZONE_ID,
        selfCharacterId: CHARACTER_ID,
        entities: [WORLD_ENTITY],
      }),
    );
    const position = parseServerMessage(
      createMessage(WORLD_POSITION_CHANGED_EVENT_TYPE, {
        entity: { ...WORLD_ENTITY, x: 55 },
      }),
    );

    expect(snapshot.ok && snapshot.kind).toBe(WORLD_SNAPSHOT_EVENT_TYPE);
    expect(position.ok && position.kind).toBe(
      WORLD_POSITION_CHANGED_EVENT_TYPE,
    );
  });

  it('parses presence join and leave events', () => {
    const joined = parseServerMessage(
      createMessage(WORLD_ENTITY_JOINED_EVENT_TYPE, { entity: WORLD_ENTITY }),
    );
    const left = parseServerMessage(
      createMessage(WORLD_ENTITY_LEFT_EVENT_TYPE, {
        characterId: CHARACTER_ID,
      }),
    );

    expect(joined.ok && joined.kind).toBe(WORLD_ENTITY_JOINED_EVENT_TYPE);
    expect(left.ok && left.kind).toBe(WORLD_ENTITY_LEFT_EVENT_TYPE);
  });

  it('rejects malformed and unknown server events', () => {
    const malformed = parseServerMessage(
      createMessage(WORLD_SNAPSHOT_EVENT_TYPE, {
        zoneId: WORLD_ZONE_ID,
        selfCharacterId: CHARACTER_ID,
        entities: [{ ...WORLD_ENTITY, x: -1 }],
      }),
    );
    const unknown = parseServerMessage(createMessage('world-weather', {}));

    expect(malformed.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (!malformed.ok) expect(malformed.code).toBe('VALIDATION_ERROR');
    if (!unknown.ok) expect(unknown.code).toBe('INVALID_MESSAGE');
  });
});
