import {
  centralSquareNpcEntities,
  centralSquareNpcPatrol,
  isWorldPositionWalkable,
  type CentralSquareNpcPatrol,
  type WorldEntity,
} from '@city/game-protocol';

/** Mutable in-memory patrol state for one zone NPC (process-local). */
export interface NpcPatrolRuntime {
  entity: WorldEntity;
  waypointIndex: number;
  idleTicksRemaining: number;
}

export function createNpcPatrolRuntimes(): Map<string, NpcPatrolRuntime> {
  const runtimes = new Map<string, NpcPatrolRuntime>();
  for (const entity of centralSquareNpcEntities()) {
    const patrol = centralSquareNpcPatrol(entity.characterId);
    const home = patrol?.waypoints[0];
    runtimes.set(entity.characterId, {
      entity: {
        ...entity,
        x: home?.x ?? entity.x,
        y: home?.y ?? entity.y,
      },
      waypointIndex: 0,
      idleTicksRemaining: patrol?.idleTicks ?? 0,
    });
  }
  return runtimes;
}

/**
 * Advances one NPC by at most one patrol step (or burns an idle tick).
 * Returns whether the entity position changed.
 */
export function advanceNpcPatrol(
  runtime: NpcPatrolRuntime,
  patrol: CentralSquareNpcPatrol,
): { runtime: NpcPatrolRuntime; moved: boolean } {
  if (patrol.waypoints.length === 0) {
    return { runtime, moved: false };
  }

  if (runtime.idleTicksRemaining > 0) {
    return {
      runtime: {
        ...runtime,
        idleTicksRemaining: runtime.idleTicksRemaining - 1,
      },
      moved: false,
    };
  }

  const { x, y } = runtime.entity;
  let waypointIndex = runtime.waypointIndex % patrol.waypoints.length;
  let target = patrol.waypoints[waypointIndex]!;

  // Finished idle at the current waypoint — aim for the next one.
  if (x === target.x && y === target.y) {
    if (patrol.waypoints.length === 1) {
      return { runtime, moved: false };
    }
    waypointIndex = (waypointIndex + 1) % patrol.waypoints.length;
    target = patrol.waypoints[waypointIndex]!;
  }

  const step = Math.max(1, Math.floor(patrol.step));
  let nextX = x;
  let nextY = y;
  if (x !== target.x) {
    const dx = target.x - x;
    nextX = x + Math.sign(dx) * Math.min(step, Math.abs(dx));
  } else if (y !== target.y) {
    const dy = target.y - y;
    nextY = y + Math.sign(dy) * Math.min(step, Math.abs(dy));
  }

  if (!isWorldPositionWalkable(nextX, nextY)) {
    // Skip a blocked segment by idling and rotating to the following waypoint.
    const skipIndex = (waypointIndex + 1) % patrol.waypoints.length;
    return {
      runtime: {
        ...runtime,
        waypointIndex: skipIndex,
        idleTicksRemaining: patrol.idleTicks,
      },
      moved: false,
    };
  }

  const arrived = nextX === target.x && nextY === target.y;
  return {
    runtime: {
      entity: { ...runtime.entity, x: nextX, y: nextY },
      waypointIndex,
      idleTicksRemaining: arrived ? patrol.idleTicks : 0,
    },
    moved: nextX !== x || nextY !== y,
  };
}

/** Ticks every NPC runtime once; returns entities whose position changed. */
export function tickNpcPatrols(
  runtimes: Map<string, NpcPatrolRuntime>,
): WorldEntity[] {
  const moved: WorldEntity[] = [];
  for (const [characterId, runtime] of runtimes) {
    const patrol = centralSquareNpcPatrol(characterId);
    if (!patrol) continue;
    const result = advanceNpcPatrol(runtime, patrol);
    runtimes.set(characterId, result.runtime);
    if (result.moved) {
      moved.push(result.runtime.entity);
    }
  }
  return moved;
}
