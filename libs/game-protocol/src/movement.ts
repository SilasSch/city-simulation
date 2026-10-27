import {
  WORLD_COORDINATE_MAX,
  WORLD_COORDINATE_MIN,
  worldZoneColliders,
  type WorldCollider,
  type WorldZoneId,
} from './protocol';

/** Laufgeschwindigkeit in logischen Einheiten pro Sekunde (≈ 3 m/s). */
export const WORLD_MOVE_SPEED = 6;
/** Fester Simulationsschritt von Server-Tick und Client-Prediction (20 Hz). */
export const WORLD_TICK_SECONDS = 0.05;
/** Kollisionsradius einer Figur in logischen Einheiten (0,5 m). */
export const WORLD_ENTITY_RADIUS = 1;

const RESOLVE_ITERATIONS = 3;

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** Begrenzt einen Richtungsvektor auf Länge 1 (diagonal nicht schneller). */
export function clampWorldInput(input: WorldPoint): WorldPoint {
  const length = Math.hypot(input.x, input.y);
  if (length <= 1) return { x: input.x, y: input.y };
  return { x: input.x / length, y: input.y / length };
}

function pushOutOfCollider(
  position: { x: number; y: number },
  collider: WorldCollider,
  radius: number,
): void {
  if (collider.kind === 'circle') {
    const dx = position.x - collider.x;
    const dy = position.y - collider.y;
    const distance = Math.hypot(dx, dy);
    const minimum = collider.radius + radius;
    if (distance >= minimum) return;
    // Genau im Mittelpunkt: deterministisch nach Süden schieben.
    const nx = distance > 0 ? dx / distance : 0;
    const ny = distance > 0 ? dy / distance : 1;
    position.x = collider.x + nx * minimum;
    position.y = collider.y + ny * minimum;
    return;
  }

  const closestX = Math.min(Math.max(position.x, collider.minX), collider.maxX);
  const closestY = Math.min(Math.max(position.y, collider.minY), collider.maxY);
  const dx = position.x - closestX;
  const dy = position.y - closestY;
  const distance = Math.hypot(dx, dy);

  if (distance > 0) {
    if (distance >= radius) return;
    position.x = closestX + (dx / distance) * radius;
    position.y = closestY + (dy / distance) * radius;
    return;
  }

  // Mittelpunkt liegt im Rechteck: über die nächste Kante hinausschieben.
  const toMinX = position.x - collider.minX;
  const toMaxX = collider.maxX - position.x;
  const toMinY = position.y - collider.minY;
  const toMaxY = collider.maxY - position.y;
  const nearest = Math.min(toMinX, toMaxX, toMinY, toMaxY);
  if (nearest === toMinX) position.x = collider.minX - radius;
  else if (nearest === toMaxX) position.x = collider.maxX + radius;
  else if (nearest === toMinY) position.y = collider.minY - radius;
  else position.y = collider.maxY + radius;
}

/**
 * Ein kinematischer Bewegungsschritt (ADR 0015): konstante Geschwindigkeit,
 * Kollision mit den gemeinsamen Zonen-Collidern und Zonengrenzen. Die Figur
 * gleitet an Wänden entlang, weil nur der eindringende Anteil zurückgeschoben
 * wird. Server-Tick und Client-Prediction rechnen mit derselben Funktion.
 */
export function stepWorldPosition(
  position: WorldPoint,
  input: WorldPoint,
  deltaSeconds: number,
  zoneId: WorldZoneId,
): WorldPoint {
  const direction = clampWorldInput(input);
  const next = {
    x: position.x + direction.x * WORLD_MOVE_SPEED * deltaSeconds,
    y: position.y + direction.y * WORLD_MOVE_SPEED * deltaSeconds,
  };
  const colliders = worldZoneColliders(zoneId);
  const min = WORLD_COORDINATE_MIN + WORLD_ENTITY_RADIUS;
  const max = WORLD_COORDINATE_MAX - WORLD_ENTITY_RADIUS;

  for (let iteration = 0; iteration < RESOLVE_ITERATIONS; iteration += 1) {
    for (const collider of colliders) {
      pushOutOfCollider(next, collider, WORLD_ENTITY_RADIUS);
    }
    next.x = Math.min(Math.max(next.x, min), max);
    next.y = Math.min(Math.max(next.y, min), max);
  }
  return next;
}
