import {
  centralSquareNpcEntities,
  centralSquareNpcPatrol,
  isWorldPositionWalkable,
  type CentralSquareNpcPatrol,
  type WorldEntity,
} from '@city/game-protocol';

/** Prozesslokaler Patrouillen-Zustand eines Zonen-NPCs. */
export interface NpcPatrolRuntime {
  entity: WorldEntity;
  waypointIndex: number;
  idleSecondsRemaining: number;
  /** Zusätzliche Pause nach einem Gruß; läuft vor Idle und Bewegung ab. */
  interactPauseSecondsRemaining: number;
}

const ARRIVAL_EPSILON = 1e-6;

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
      idleSecondsRemaining: patrol?.idleSeconds ?? 0,
      interactPauseSecondsRemaining: 0,
    });
  }
  return runtimes;
}

/**
 * Bewegt einen NPC um `deltaSeconds` stufenlos auf seinen nächsten Wegpunkt
 * zu (oder lässt Pause bzw. Idle-Zeit ablaufen). Am Wegpunkt beginnt die
 * Idle-Zeit; ein blockierter Abschnitt wird übersprungen.
 */
export function advanceNpcPatrol(
  runtime: NpcPatrolRuntime,
  patrol: CentralSquareNpcPatrol,
  deltaSeconds: number,
): { runtime: NpcPatrolRuntime; moved: boolean } {
  if (patrol.waypoints.length === 0) {
    return { runtime, moved: false };
  }

  if (runtime.interactPauseSecondsRemaining > ARRIVAL_EPSILON) {
    return {
      runtime: {
        ...runtime,
        interactPauseSecondsRemaining: Math.max(
          0,
          runtime.interactPauseSecondsRemaining - deltaSeconds,
        ),
      },
      moved: false,
    };
  }

  if (runtime.idleSecondsRemaining > ARRIVAL_EPSILON) {
    return {
      runtime: {
        ...runtime,
        idleSecondsRemaining: Math.max(
          0,
          runtime.idleSecondsRemaining - deltaSeconds,
        ),
      },
      moved: false,
    };
  }

  const { x, y } = runtime.entity;
  let waypointIndex = runtime.waypointIndex % patrol.waypoints.length;
  let target = patrol.waypoints[waypointIndex];
  if (!target) return { runtime, moved: false };

  // Idle am aktuellen Wegpunkt beendet: den nächsten ansteuern.
  if (Math.hypot(target.x - x, target.y - y) <= ARRIVAL_EPSILON) {
    if (patrol.waypoints.length === 1) return { runtime, moved: false };
    waypointIndex = (waypointIndex + 1) % patrol.waypoints.length;
    target = patrol.waypoints[waypointIndex];
    if (!target) return { runtime, moved: false };
  }

  const distance = Math.hypot(target.x - x, target.y - y);
  const travel = Math.min(distance, patrol.speed * deltaSeconds);
  const arrived = distance - travel <= ARRIVAL_EPSILON;
  const nextX = arrived ? target.x : x + ((target.x - x) / distance) * travel;
  const nextY = arrived ? target.y : y + ((target.y - y) / distance) * travel;

  if (!isWorldPositionWalkable(nextX, nextY)) {
    return {
      runtime: {
        ...runtime,
        waypointIndex: (waypointIndex + 1) % patrol.waypoints.length,
        idleSecondsRemaining: patrol.idleSeconds,
      },
      moved: false,
    };
  }

  return {
    runtime: {
      entity: { ...runtime.entity, x: nextX, y: nextY },
      waypointIndex,
      idleSecondsRemaining: arrived ? patrol.idleSeconds : 0,
      interactPauseSecondsRemaining: 0,
    },
    moved: nextX !== x || nextY !== y,
  };
}

/** Bewegt alle NPCs um `deltaSeconds`; liefert die bewegten Entities. */
export function tickNpcPatrols(
  runtimes: Map<string, NpcPatrolRuntime>,
  deltaSeconds: number,
): WorldEntity[] {
  const moved: WorldEntity[] = [];
  for (const [characterId, runtime] of runtimes) {
    const patrol = centralSquareNpcPatrol(characterId);
    if (!patrol) continue;
    const result = advanceNpcPatrol(runtime, patrol, deltaSeconds);
    runtimes.set(characterId, result.runtime);
    if (result.moved) {
      moved.push(result.runtime.entity);
    }
  }
  return moved;
}
