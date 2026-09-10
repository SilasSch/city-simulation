import { describe, expect, it } from 'vitest';
import {
  CENTRAL_SQUARE_NPCS,
  MARKET_LANE_ZONE_ID,
  WORLD_ZONE_ID,
  type WorldEntity,
} from '@city/game-protocol';
import { WorldPresenceService } from './world-presence.service';

const AYLA: WorldEntity = {
  characterId: '11111111-1111-4111-8111-111111111111',
  kind: 'character',
  name: 'Ayla',
  x: 50,
  y: 70,
  energy: 90,
  money: 0,
  interaction: null,
};

const NACHBAR = CENTRAL_SQUARE_NPCS[0]!;

describe('WorldPresenceService', () => {
  it('keeps one entity for multiple sockets and leaves after the last socket', () => {
    const presence = new WorldPresenceService();

    expect(presence.enter('socket-a', AYLA, WORLD_ZONE_ID)).toBe(true);
    expect(presence.enter('socket-b', AYLA, WORLD_ZONE_ID)).toBe(false);
    expect(presence.entities(WORLD_ZONE_ID)).toEqual(
      expect.arrayContaining([
        AYLA,
        expect.objectContaining({ characterId: NACHBAR.characterId }),
      ]),
    );
    expect(presence.characterIds()).toEqual([AYLA.characterId]);

    expect(presence.leave('socket-a')).toEqual({
      characterId: AYLA.characterId,
      zoneId: WORLD_ZONE_ID,
      lastSocket: false,
    });
    expect(presence.entities(WORLD_ZONE_ID)).toEqual(
      expect.arrayContaining([
        AYLA,
        expect.objectContaining({ characterId: NACHBAR.characterId }),
      ]),
    );

    expect(presence.leave('socket-b')).toEqual({
      characterId: AYLA.characterId,
      zoneId: WORLD_ZONE_ID,
      lastSocket: true,
    });
    expect(presence.entities(WORLD_ZONE_ID)).toEqual([
      expect.objectContaining({
        characterId: NACHBAR.characterId,
        kind: 'npc',
      }),
    ]);
    expect(presence.characterIds()).toEqual([]);
  });

  it('updates the confirmed entity used by later snapshots', () => {
    const presence = new WorldPresenceService();
    presence.enter('socket-a', AYLA, WORLD_ZONE_ID);

    presence.update({ ...AYLA, x: 55 });

    expect(presence.entities(WORLD_ZONE_ID)).toEqual(
      expect.arrayContaining([
        { ...AYLA, x: 55 },
        expect.objectContaining({ characterId: NACHBAR.characterId }),
      ]),
    );
  });

  it('always includes the fixed Central Square NPC in the snapshot list', () => {
    const presence = new WorldPresenceService();
    expect(presence.entities(WORLD_ZONE_ID)).toEqual([
      expect.objectContaining({
        characterId: NACHBAR.characterId,
        kind: 'npc',
        name: 'Nachbar',
      }),
    ]);
    expect(presence.enter('socket-npc', NACHBAR, WORLD_ZONE_ID)).toBe(false);
    expect(presence.characterIds()).toEqual([]);
  });

  it('ignores client NPC position updates but advances patrol on the server tick', () => {
    const presence = new WorldPresenceService();
    const before = presence
      .entities(WORLD_ZONE_ID)
      .find((e) => e.characterId === NACHBAR.characterId)!;

    presence.update({ ...before, x: 10, y: 10 });
    expect(
      presence
        .entities(WORLD_ZONE_ID)
        .find((e) => e.characterId === NACHBAR.characterId),
    ).toEqual(before);

    // Burn idle ticks then expect a server-driven step.
    let moved: WorldEntity[] = [];
    for (let i = 0; i < 8 && moved.length === 0; i += 1) {
      moved = presence.advanceNpcs();
    }
    expect(moved.length).toBe(1);
    expect(moved[0]!.characterId).toBe(NACHBAR.characterId);
    expect(moved[0]!).not.toEqual(before);
    expect(
      presence
        .entities(WORLD_ZONE_ID)
        .find((e) => e.characterId === NACHBAR.characterId),
    ).toEqual(moved[0]);
  });

  it('pauses NPC patrol after interact without dropping the entity', () => {
    const presence = new WorldPresenceService();
    const before = presence.npc(NACHBAR.characterId)!;
    presence.pauseNpcInteract(NACHBAR.characterId, 3);

    for (let i = 0; i < 3; i += 1) {
      expect(presence.advanceNpcs()).toEqual([]);
      expect(presence.npc(NACHBAR.characterId)).toEqual(before);
    }
  });

  it('scopes presence and NPCs per zone', () => {
    const presence = new WorldPresenceService();
    presence.enter('socket-a', AYLA, MARKET_LANE_ZONE_ID);

    expect(presence.entities(MARKET_LANE_ZONE_ID)).toEqual([AYLA]);
    expect(presence.entities(WORLD_ZONE_ID)).toEqual([
      expect.objectContaining({
        characterId: NACHBAR.characterId,
        kind: 'npc',
      }),
    ]);
    expect(presence.zoneOf(AYLA.characterId)).toBe(MARKET_LANE_ZONE_ID);
  });
});
