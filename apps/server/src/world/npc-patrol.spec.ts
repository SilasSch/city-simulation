import { describe, expect, it } from 'vitest';
import {
  CENTRAL_SQUARE_NPCS,
  CENTRAL_SQUARE_NPC_PATROLS,
  isWorldPositionWalkable,
} from '@city/game-protocol';
import {
  advanceNpcPatrol,
  createNpcPatrolRuntimes,
  tickNpcPatrols,
} from './npc-patrol';

describe('npc patrol', () => {
  it('keeps every catalog waypoint and home position walkable', () => {
    for (const npc of CENTRAL_SQUARE_NPCS) {
      expect(isWorldPositionWalkable(npc.x, npc.y)).toBe(true);
    }
    for (const patrol of CENTRAL_SQUARE_NPC_PATROLS) {
      expect(patrol.waypoints.length).toBeGreaterThan(1);
      for (const waypoint of patrol.waypoints) {
        expect(isWorldPositionWalkable(waypoint.x, waypoint.y)).toBe(true);
      }
    }
  });

  it('moves one step toward the next waypoint after idle ends', () => {
    const runtimes = createNpcPatrolRuntimes();
    const nachbar = CENTRAL_SQUARE_NPCS[0]!;
    const patrol = CENTRAL_SQUARE_NPC_PATROLS[0]!;
    const runtime = runtimes.get(nachbar.characterId)!;

    expect(runtime.entity.x).toBe(42);
    expect(runtime.entity.y).toBe(58);
    expect(runtime.idleTicksRemaining).toBe(patrol.idleTicks);

    let current = runtime;
    for (let i = 0; i < patrol.idleTicks; i += 1) {
      const paused = advanceNpcPatrol(current, patrol);
      expect(paused.moved).toBe(false);
      expect(paused.runtime.entity.x).toBe(42);
      expect(paused.runtime.entity.y).toBe(58);
      current = paused.runtime;
    }

    const moved = advanceNpcPatrol(current, patrol);
    expect(moved.moved).toBe(true);
    expect(moved.runtime.entity).toEqual(
      expect.objectContaining({
        characterId: nachbar.characterId,
        kind: 'npc',
        x: 41,
        y: 58,
      }),
    );
    expect(
      isWorldPositionWalkable(moved.runtime.entity.x, moved.runtime.entity.y),
    ).toBe(true);
  });

  it('stays inside walkable Central Square bounds across a full loop', () => {
    const runtimes = createNpcPatrolRuntimes();
    const patrol = CENTRAL_SQUARE_NPC_PATROLS[0]!;
    const home = patrol.waypoints[0]!;

    // Idle + steps around the rectangle should revisit home without leaving bounds.
    const budget =
      patrol.idleTicks * patrol.waypoints.length +
      patrol.waypoints.reduce((sum, point, index) => {
        const previous =
          patrol.waypoints[
            (index - 1 + patrol.waypoints.length) % patrol.waypoints.length
          ]!;
        return (
          sum + Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)
        );
      }, 0) +
      5;

    let sawDeparture = false;
    for (let tick = 0; tick < budget; tick += 1) {
      const moved = tickNpcPatrols(runtimes);
      const entity = runtimes.get(patrol.characterId)!.entity;
      expect(isWorldPositionWalkable(entity.x, entity.y)).toBe(true);
      if (entity.x !== home.x || entity.y !== home.y) {
        sawDeparture = true;
      }
      for (const update of moved) {
        expect(update.kind).toBe('npc');
        expect(isWorldPositionWalkable(update.x, update.y)).toBe(true);
      }
    }

    expect(sawDeparture).toBe(true);
  });
});
