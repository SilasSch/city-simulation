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

  it('walks toward the next waypoint at patrol speed after the idle time', () => {
    const runtimes = createNpcPatrolRuntimes();
    const nachbar = CENTRAL_SQUARE_NPCS[0]!;
    const patrol = CENTRAL_SQUARE_NPC_PATROLS[0]!;
    const runtime = runtimes.get(nachbar.characterId)!;

    expect(runtime.entity.x).toBe(42);
    expect(runtime.entity.y).toBe(58);
    expect(runtime.idleSecondsRemaining).toBe(patrol.idleSeconds);

    const idle = advanceNpcPatrol(runtime, patrol, patrol.idleSeconds);
    expect(idle.moved).toBe(false);
    expect(idle.runtime.entity).toMatchObject({ x: 42, y: 58 });

    // Nächster Wegpunkt (34, 58): nach 1 s um `speed` Einheiten näher.
    const moved = advanceNpcPatrol(idle.runtime, patrol, 1);
    expect(moved.moved).toBe(true);
    expect(moved.runtime.entity).toEqual(
      expect.objectContaining({
        characterId: nachbar.characterId,
        kind: 'npc',
        x: 42 - patrol.speed,
        y: 58,
      }),
    );
  });

  it('reaches the waypoint exactly and idles there again', () => {
    const runtimes = createNpcPatrolRuntimes();
    const patrol = CENTRAL_SQUARE_NPC_PATROLS[0]!;
    let runtime = runtimes.get(patrol.characterId)!;
    runtime = { ...runtime, idleSecondsRemaining: 0 };

    const arrived = advanceNpcPatrol(runtime, patrol, 8 / patrol.speed + 1);
    expect(arrived.runtime.entity).toMatchObject({ x: 34, y: 58 });
    expect(arrived.runtime.idleSecondsRemaining).toBe(patrol.idleSeconds);
  });

  it('stays inside walkable Central Square bounds across a full loop', () => {
    const runtimes = createNpcPatrolRuntimes();
    const patrol = CENTRAL_SQUARE_NPC_PATROLS[0]!;
    const home = patrol.waypoints[0]!;
    const loopLength = patrol.waypoints.reduce((sum, point, index) => {
      const previous =
        patrol.waypoints[
          (index - 1 + patrol.waypoints.length) % patrol.waypoints.length
        ]!;
      return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
    }, 0);
    const seconds =
      patrol.idleSeconds * patrol.waypoints.length + loopLength / patrol.speed;

    let sawDeparture = false;
    let returnedHome = false;
    for (let tick = 0; tick < (seconds + 1) / 0.05; tick += 1) {
      const moved = tickNpcPatrols(runtimes, 0.05);
      const entity = runtimes.get(patrol.characterId)!.entity;
      expect(isWorldPositionWalkable(entity.x, entity.y)).toBe(true);
      if (entity.x !== home.x || entity.y !== home.y) sawDeparture = true;
      else if (sawDeparture) returnedHome = true;
      for (const update of moved) expect(update.kind).toBe('npc');
    }

    expect(sawDeparture).toBe(true);
    expect(returnedHome).toBe(true);
  });

  it('holds still during interact pause before resuming idle/move', () => {
    const runtimes = createNpcPatrolRuntimes();
    const nachbar = CENTRAL_SQUARE_NPCS[0]!;
    const patrol = CENTRAL_SQUARE_NPC_PATROLS[0]!;
    let runtime = runtimes.get(nachbar.characterId)!;
    runtime = {
      ...runtime,
      idleSecondsRemaining: 0,
      interactPauseSecondsRemaining: 0.1,
    };

    const first = advanceNpcPatrol(runtime, patrol, 0.05);
    expect(first.moved).toBe(false);
    expect(first.runtime.interactPauseSecondsRemaining).toBeCloseTo(0.05);
    expect(first.runtime.entity.x).toBe(runtime.entity.x);

    const second = advanceNpcPatrol(first.runtime, patrol, 0.05);
    expect(second.moved).toBe(false);

    const third = advanceNpcPatrol(second.runtime, patrol, 0.05);
    expect(third.moved).toBe(true);
  });
});
