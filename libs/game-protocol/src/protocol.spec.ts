import { describe, expect, it } from 'vitest';
import {
  CONNECT_COMMAND_TYPE,
  PROTOCOL_VERSION,
  WORLD_ENTITY_JOINED_EVENT_TYPE,
  WORLD_ENTITY_LEFT_EVENT_TYPE,
  WORLD_COORDINATE_MAX,
  WORLD_ENTER_COMMAND_TYPE,
  WORLD_INPUT_COMMAND_TYPE,
  WORLD_POSITIONS_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  WORLD_ZONE_ID,
  MARKET_LANE_ZONE_ID,
  MARKET_LANE_SPAWN_POSITION,
  CENTRAL_SQUARE_NPCS,
  CENTRAL_SQUARE_NPC_GREETINGS,
  CENTRAL_SQUARE_NPC_PATROLS,
  WORLD_INTERACT_COMMAND_TYPE,
  WORLD_INTERACT_RESULT_EVENT_TYPE,
  WORLD_TRANSITION_COMMAND_TYPE,
  WORLD_ZONE_PORTALS,
  worldInteractPayloadSchema,
  worldInteractResultPayloadSchema,
  worldTransitionPayloadSchema,
  worldInteractionObject,
  worldInteractionObjectsIn,
  worldZonePortal,
  worldZonePortalsIn,
  connectionEstablishedPayloadSchema,
  connectPayloadSchema,
  createMessage,
  isWorldPositionWalkable,
  mergeZoneNpcEntities,
  protocolEnvelopeSchema,
  worldEntitySchema,
  worldEnterPayloadSchema,
  worldSnapshotPayloadSchema,
  worldZoneIdSchema,
} from './protocol';
import {
  WORLD_ENTITY_RADIUS,
  WORLD_MOVE_SPEED,
  WORLD_TICK_SECONDS,
  stepWorldPosition,
} from './movement';
import { parseIncomingMessage, parseServerMessage } from './parse';

const CHARACTER_ID = '3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e';
const WORLD_ENTITY = {
  characterId: CHARACTER_ID,
  kind: 'character' as const,
  name: 'Ayla',
  x: 50,
  y: 50,
  energy: 90,
  money: 0,
  interaction: null,
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
    expect(
      isWorldPositionWalkable(
        MARKET_LANE_SPAWN_POSITION.x,
        MARKET_LANE_SPAWN_POSITION.y,
        MARKET_LANE_ZONE_ID,
      ),
    ).toBe(true);
    expect(isWorldPositionWalkable(10, 10, MARKET_LANE_ZONE_ID)).toBe(false);
    expect(isWorldPositionWalkable(50, 50, MARKET_LANE_ZONE_ID)).toBe(true);
    // Mid-lane corridor spawn → west portal stays clear (#72); crate-west is north of y=50.
    expect(isWorldPositionWalkable(28, 33, MARKET_LANE_ZONE_ID)).toBe(false);
    for (let x = MARKET_LANE_SPAWN_POSITION.x; x >= 5; x -= 2.5) {
      expect(isWorldPositionWalkable(x, 50, MARKET_LANE_ZONE_ID)).toBe(true);
    }
  });

  it('moves continuously at constant speed without diagonal boost', () => {
    const start = { x: 50, y: 70 };
    const east = stepWorldPosition(
      start,
      { x: 1, y: 0 },
      WORLD_TICK_SECONDS,
      WORLD_ZONE_ID,
    );
    expect(east.x).toBeCloseTo(50 + WORLD_MOVE_SPEED * WORLD_TICK_SECONDS);
    expect(east.y).toBeCloseTo(70);

    const diagonal = stepWorldPosition(start, { x: 1, y: 1 }, 1, WORLD_ZONE_ID);
    expect(Math.hypot(diagonal.x - start.x, diagonal.y - start.y)).toBeCloseTo(
      WORLD_MOVE_SPEED,
    );
    expect(stepWorldPosition(start, { x: 0, y: 0 }, 1, WORLD_ZONE_ID)).toEqual(
      start,
    );
  });

  it('slides along rectangle and circle colliders instead of sticking', () => {
    // Diagonal gegen die Südkante von building-north-west (maxY 20).
    let position = { x: 15, y: 22 };
    for (let tick = 0; tick < 20; tick += 1) {
      position = stepWorldPosition(
        position,
        { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
        WORLD_TICK_SECONDS,
        WORLD_ZONE_ID,
      );
    }
    expect(position.y).toBeCloseTo(20 + WORLD_ENTITY_RADIUS);
    expect(position.x).toBeGreaterThan(15 + 3);

    // Gegen den Brunnen (Radius 8): Kontakt bleibt außerhalb, Bewegung tangential.
    position = { x: 47, y: 60 };
    for (let tick = 0; tick < 40; tick += 1) {
      position = stepWorldPosition(
        position,
        { x: 0, y: -1 },
        WORLD_TICK_SECONDS,
        WORLD_ZONE_ID,
      );
    }
    expect(Math.hypot(position.x - 50, position.y - 50)).toBeGreaterThanOrEqual(
      8 + WORLD_ENTITY_RADIUS - 1e-9,
    );
    expect(position.x).toBeLessThan(47);
  });

  it('keeps continuous movement inside the zone bounds', () => {
    const position = stepWorldPosition(
      { x: 50, y: 98.5 },
      { x: 0, y: 1 },
      1,
      WORLD_ZONE_ID,
    );
    expect(position.y).toBe(WORLD_COORDINATE_MAX - WORLD_ENTITY_RADIUS);
  });

  it('validates complete world snapshots', () => {
    expect(
      worldSnapshotPayloadSchema.safeParse({
        zoneId: WORLD_ZONE_ID,
        selfCharacterId: CHARACTER_ID,
        clock: {
          simulatedTime: '2026-01-01T00:00:00.000Z',
          speed: 60,
        },
        entities: [WORLD_ENTITY],
      }).success,
    ).toBe(true);
  });

  it('defaults missing entity kind to character and accepts NPCs', () => {
    const withoutKind = {
      characterId: CHARACTER_ID,
      name: 'Ayla',
      x: 50,
      y: 50,
      energy: 90,
      money: 0,
      interaction: null,
    };
    const parsed = worldEntitySchema.safeParse(withoutKind);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe('character');
    }

    const npc = CENTRAL_SQUARE_NPCS[0];
    expect(npc).toBeDefined();
    expect(worldEntitySchema.safeParse(npc).success).toBe(true);
    expect(npc?.kind).toBe('npc');
    expect(isWorldPositionWalkable(npc!.x, npc!.y)).toBe(true);
  });

  it('merges fixed Central Square NPCs into zone entity lists', () => {
    const merged = mergeZoneNpcEntities(WORLD_ZONE_ID, [WORLD_ENTITY]);
    expect(merged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          characterId: CHARACTER_ID,
          kind: 'character',
        }),
        expect.objectContaining({
          characterId: CENTRAL_SQUARE_NPCS[0]!.characterId,
          kind: 'npc',
          name: 'Nachbar',
        }),
      ]),
    );
    expect(mergeZoneNpcEntities(MARKET_LANE_ZONE_ID, [WORLD_ENTITY])).toEqual([
      WORLD_ENTITY,
    ]);
  });

  it('accepts market-lane as a world zone id and rejects unknowns', () => {
    expect(worldZoneIdSchema.safeParse(WORLD_ZONE_ID).success).toBe(true);
    expect(worldZoneIdSchema.safeParse(MARKET_LANE_ZONE_ID).success).toBe(true);
    expect(worldZoneIdSchema.safeParse('unknown-zone').success).toBe(false);
    expect(
      worldEnterPayloadSchema.safeParse({ zoneId: MARKET_LANE_ZONE_ID })
        .success,
    ).toBe(true);
  });

  it('defines bidirectional zone portals on walkable positions', () => {
    expect(WORLD_ZONE_PORTALS.length).toBe(2);
    const east = worldZonePortal('central-square-east');
    const west = worldZonePortal('market-lane-west');
    expect(east).toMatchObject({
      fromZoneId: WORLD_ZONE_ID,
      toZoneId: MARKET_LANE_ZONE_ID,
      label: 'Zur Marktgasse',
    });
    expect(west).toMatchObject({
      fromZoneId: MARKET_LANE_ZONE_ID,
      toZoneId: WORLD_ZONE_ID,
      label: 'Zum Platz',
    });
    expect(isWorldPositionWalkable(east.x, east.y, east.fromZoneId)).toBe(true);
    expect(isWorldPositionWalkable(west.x, west.y, west.fromZoneId)).toBe(true);
    expect(worldZonePortalsIn(WORLD_ZONE_ID).map((p) => p.id)).toEqual([
      'central-square-east',
    ]);
    expect(
      worldTransitionPayloadSchema.safeParse({
        portalId: 'central-square-east',
      }).success,
    ).toBe(true);
    expect(
      worldTransitionPayloadSchema.safeParse({ portalId: 'nope' }).success,
    ).toBe(false);
  });

  it('prefers live NPC positions over the catalog when merging', () => {
    const live = {
      ...CENTRAL_SQUARE_NPCS[0]!,
      x: 34,
      y: 70,
    };
    const merged = mergeZoneNpcEntities(WORLD_ZONE_ID, [live]);
    expect(
      merged.find((entity) => entity.characterId === live.characterId),
    ).toEqual(live);
  });

  it('defines walkable patrol waypoints for Central Square NPCs', () => {
    expect(CENTRAL_SQUARE_NPC_PATROLS.length).toBeGreaterThan(0);
    for (const patrol of CENTRAL_SQUARE_NPC_PATROLS) {
      expect(
        CENTRAL_SQUARE_NPCS.some(
          (npc) => npc.characterId === patrol.characterId,
        ),
      ).toBe(true);
      for (const waypoint of patrol.waypoints) {
        expect(isWorldPositionWalkable(waypoint.x, waypoint.y)).toBe(true);
      }
    }
  });

  it('defines a walkable market-lane stall job', () => {
    const stall = worldInteractionObject('stall-north');
    expect(stall).toMatchObject({
      kind: 'stall',
      zoneId: MARKET_LANE_ZONE_ID,
      moneyGain: 20,
      durationSimulationSeconds: 150,
      price: 0,
    });
    expect(isWorldPositionWalkable(stall.x, stall.y, MARKET_LANE_ZONE_ID)).toBe(
      true,
    );
    expect(
      worldInteractionObjectsIn(MARKET_LANE_ZONE_ID).map((object) => object.id),
    ).toEqual(['stall-north', 'street-food-east']);
    expect(
      worldInteractionObjectsIn(WORLD_ZONE_ID).map((object) => object.id),
    ).toEqual(['bench-south', 'kiosk-north', 'snack-east']);
    expect(
      worldInteractPayloadSchema.safeParse({ objectId: 'stall-north' }).success,
    ).toBe(true);
  });

  it('defines a walkable market-lane street-food shop', () => {
    const shop = worldInteractionObject('street-food-east');
    expect(shop).toMatchObject({
      kind: 'shop',
      zoneId: MARKET_LANE_ZONE_ID,
      price: 15,
      energyGain: 20,
      durationSimulationSeconds: 0,
      moneyGain: 0,
    });
    expect(isWorldPositionWalkable(shop.x, shop.y, MARKET_LANE_ZONE_ID)).toBe(
      true,
    );
    expect(
      worldInteractPayloadSchema.safeParse({ objectId: 'street-food-east' })
        .success,
    ).toBe(true);
  });

  it('accepts world-interact payloads for objects and NPCs', () => {
    expect(
      worldInteractPayloadSchema.safeParse({ objectId: 'bench-south' }).success,
    ).toBe(true);
    expect(
      worldInteractPayloadSchema.safeParse({
        npcCharacterId: CENTRAL_SQUARE_NPCS[0]!.characterId,
      }).success,
    ).toBe(true);
    expect(worldInteractPayloadSchema.safeParse({}).success).toBe(false);
    expect(
      CENTRAL_SQUARE_NPC_GREETINGS[CENTRAL_SQUARE_NPCS[0]!.characterId],
    ).toMatch(/Kiosk|Snack/);
  });

  it('validates world-interact-result greet payloads', () => {
    expect(
      worldInteractResultPayloadSchema.safeParse({
        kind: 'npc-greet',
        npcCharacterId: CENTRAL_SQUARE_NPCS[0]!.characterId,
        npcName: 'Nachbar',
        message: 'Hallo!',
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

  it('parses world-enter and world-input commands', () => {
    const enter = parseIncomingMessage(
      createMessage(WORLD_ENTER_COMMAND_TYPE, { zoneId: WORLD_ZONE_ID }),
    );
    const input = parseIncomingMessage(
      createMessage(WORLD_INPUT_COMMAND_TYPE, {
        seq: 3,
        x: Math.SQRT1_2,
        y: -Math.SQRT1_2,
      }),
    );

    expect(enter.ok && enter.kind).toBe(WORLD_ENTER_COMMAND_TYPE);
    expect(input.ok && input.kind).toBe(WORLD_INPUT_COMMAND_TYPE);
  });

  it('parses world-transition commands', () => {
    const transition = parseIncomingMessage(
      createMessage(WORLD_TRANSITION_COMMAND_TYPE, {
        portalId: 'central-square-east',
      }),
    );
    expect(transition.ok && transition.kind).toBe(
      WORLD_TRANSITION_COMMAND_TYPE,
    );
  });

  it('parses world-interact object and npc commands', () => {
    const objectInteract = parseIncomingMessage(
      createMessage(WORLD_INTERACT_COMMAND_TYPE, { objectId: 'kiosk-north' }),
    );
    const npcInteract = parseIncomingMessage(
      createMessage(WORLD_INTERACT_COMMAND_TYPE, {
        npcCharacterId: CENTRAL_SQUARE_NPCS[0]!.characterId,
      }),
    );
    expect(objectInteract.ok && objectInteract.kind).toBe(
      WORLD_INTERACT_COMMAND_TYPE,
    );
    expect(npcInteract.ok && npcInteract.kind).toBe(
      WORLD_INTERACT_COMMAND_TYPE,
    );
  });

  it('parses world-interact-result events', () => {
    const result = parseServerMessage(
      createMessage(WORLD_INTERACT_RESULT_EVENT_TYPE, {
        kind: 'npc-greet',
        npcCharacterId: CENTRAL_SQUARE_NPCS[0]!.characterId,
        npcName: 'Nachbar',
        message: 'Hallo!',
      }),
    );
    expect(result.ok && result.kind).toBe(WORLD_INTERACT_RESULT_EVENT_TYPE);
  });

  it('rejects invalid zones and movement inputs', () => {
    const enter = parseIncomingMessage(
      createMessage(WORLD_ENTER_COMMAND_TYPE, { zoneId: 'other-zone' }),
    );
    const tooLong = parseIncomingMessage(
      createMessage(WORLD_INPUT_COMMAND_TYPE, { seq: 1, x: 1, y: 1 }),
    );
    const legacyMove = parseIncomingMessage(
      createMessage('world-move', { direction: 'E' }),
    );

    expect(enter.ok).toBe(false);
    expect(tooLong.ok).toBe(false);
    expect(legacyMove.ok).toBe(false);
    if (!enter.ok) expect(enter.code).toBe('VALIDATION_ERROR');
    if (!tooLong.ok) expect(tooLong.code).toBe('VALIDATION_ERROR');
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
        clock: {
          simulatedTime: '2026-01-01T00:00:00.000Z',
          speed: 60,
        },
        entities: [WORLD_ENTITY],
      }),
    );
    const positions = parseServerMessage(
      createMessage(WORLD_POSITIONS_EVENT_TYPE, {
        zoneId: WORLD_ZONE_ID,
        entities: [{ characterId: CHARACTER_ID, x: 55.3, y: 50, seq: 7 }],
      }),
    );

    expect(snapshot.ok && snapshot.kind).toBe(WORLD_SNAPSHOT_EVENT_TYPE);
    expect(positions.ok && positions.kind).toBe(WORLD_POSITIONS_EVENT_TYPE);
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
        clock: {
          simulatedTime: '2026-01-01T00:00:00.000Z',
          speed: 60,
        },
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

describe('character currency', () => {
  it('rejects negative character money', () => {
    expect(
      worldEntitySchema.safeParse({ ...WORLD_ENTITY, money: -1 }).success,
    ).toBe(false);
  });

  it('accepts zero and positive integer money', () => {
    expect(
      worldEntitySchema.safeParse({ ...WORLD_ENTITY, money: 0 }).success,
    ).toBe(true);
    expect(
      worldEntitySchema.safeParse({ ...WORLD_ENTITY, money: 250 }).success,
    ).toBe(true);
  });
});
