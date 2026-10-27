import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  MARKET_LANE_ZONE_ID,
  WORLD_COORDINATE_MAX,
  WORLD_COORDINATE_MIN,
  WORLD_TICK_SECONDS,
  WORLD_ZONE_ID,
  worldInteractionObjectsIn,
  worldZoneColliders,
  worldZonePortalsIn,
} from '@city/game-protocol';
import type {
  WorldCollider,
  WorldEntity,
  WorldPoint,
  WorldInteractionObject,
  WorldInteractionObjectId,
  WorldZoneId,
} from '@city/game-protocol';

/** Eine logische Einheit entspricht 0,5 m (ADR 0014). */
export const WORLD_UNIT_METERS = 0.5;

const WORLD_CENTER = (WORLD_COORDINATE_MIN + WORLD_COORDINATE_MAX) / 2;
const ZONE_SIZE_METERS =
  (WORLD_COORDINATE_MAX - WORLD_COORDINATE_MIN) * WORLD_UNIT_METERS;

/** Projiziert logische Bodenkoordinaten `(x, y)` auf die Szene `(x, h, z)`. */
export function toScenePosition(
  x: number,
  y: number,
  height = 0,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  return target.set(
    (x - WORLD_CENTER) * WORLD_UNIT_METERS,
    height,
    (y - WORLD_CENTER) * WORLD_UNIT_METERS,
  );
}

interface ZoneStyle {
  readonly name: string;
  readonly ground: number;
  readonly surroundings: number;
  readonly sky: number;
}

const ZONE_STYLES: Record<WorldZoneId, ZoneStyle> = {
  [WORLD_ZONE_ID]: {
    name: 'Zentraler Platz',
    ground: 0xa7ab9c,
    surroundings: 0x5d7350,
    sky: 0xa9c9e2,
  },
  [MARKET_LANE_ZONE_ID]: {
    name: 'Marktgasse',
    ground: 0xb39a78,
    surroundings: 0x6b5a45,
    sky: 0xe4cfb0,
  },
};

export function zoneDisplayName(zoneId: WorldZoneId): string {
  return ZONE_STYLES[zoneId].name;
}

export function zoneSkyColor(zoneId: WorldZoneId): number {
  return ZONE_STYLES[zoneId].sky;
}

const OBJECT_LABELS: Record<WorldInteractionObjectId, string> = {
  'bench-south': 'Bank',
  'kiosk-north': 'Kiosk (Job)',
  'snack-east': 'Snack',
  'stall-north': 'Marktstand (Job)',
  'street-food-east': 'Straßenessen',
};

interface BoxSpec {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly color: number;
}

const OBJECT_BOXES: Record<WorldInteractionObject['kind'], BoxSpec> = {
  bench: { width: 2, height: 0.5, depth: 0.7, color: 0x8b5e3c },
  kiosk: { width: 2, height: 2.6, depth: 2, color: 0x2f7d6d },
  shop: { width: 1.6, height: 1.8, depth: 1.6, color: 0xc2410c },
  stall: { width: 2.4, height: 2.2, depth: 1.6, color: 0xb7791f },
};

function colliderStyle(collider: WorldCollider): {
  height: number;
  color: number;
} {
  if (collider.id.startsWith('building')) return { height: 8, color: 0xd6d3cc };
  if (collider.id.startsWith('stall')) return { height: 3.5, color: 0xc9a46b };
  if (collider.id.startsWith('crate')) return { height: 1.2, color: 0x8b6b4a };
  if (collider.kind === 'circle') return { height: 0.8, color: 0x7fb4d6 };
  return { height: 2, color: 0x9ca3af };
}

/** Kleine DOM-Beschriftung, die CSS2DRenderer über der Szene positioniert. */
export function createLabel(
  text: string,
  options: { color?: string; background?: string } = {},
): CSS2DObject {
  const element = document.createElement('div');
  element.textContent = text;
  element.style.color = options.color ?? '#f8fafc';
  element.style.background = options.background ?? 'rgba(15, 23, 42, 0.72)';
  element.style.padding = '2px 6px';
  element.style.borderRadius = '4px';
  element.style.font = '600 12px system-ui, sans-serif';
  element.style.whiteSpace = 'nowrap';
  element.style.pointerEvents = 'none';
  return new CSS2DObject(element);
}

function groundRing(
  radiusMeters: number,
  color: number,
  opacity: number,
): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(0, radiusMeters - 0.12), radiusMeters, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  return ring;
}

function colliderMesh(collider: WorldCollider): THREE.Mesh {
  const style = colliderStyle(collider);
  const material = new THREE.MeshStandardMaterial({
    color: style.color,
    roughness: 0.9,
  });

  if (collider.kind === 'circle') {
    const radius = collider.radius * WORLD_UNIT_METERS;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, style.height, 48),
      material,
    );
    toScenePosition(collider.x, collider.y, style.height / 2, mesh.position);
    mesh.name = collider.id;
    return mesh;
  }

  const width = (collider.maxX - collider.minX) * WORLD_UNIT_METERS;
  const depth = (collider.maxY - collider.minY) * WORLD_UNIT_METERS;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, style.height, depth),
    material,
  );
  toScenePosition(
    (collider.minX + collider.maxX) / 2,
    (collider.minY + collider.maxY) / 2,
    style.height / 2,
    mesh.position,
  );
  mesh.name = collider.id;
  return mesh;
}

function interactionObjectGroup(object: WorldInteractionObject): THREE.Group {
  const box = OBJECT_BOXES[object.kind];
  const group = new THREE.Group();
  group.name = object.id;
  toScenePosition(object.x, object.y, 0, group.position);

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(box.width, box.height, box.depth),
    new THREE.MeshStandardMaterial({ color: box.color, roughness: 0.8 }),
  );
  mesh.position.y = box.height / 2;
  group.add(mesh);
  group.add(
    groundRing(object.interactionRange * WORLD_UNIT_METERS, 0x38bdf8, 0.35),
  );

  const label = createLabel(OBJECT_LABELS[object.id]);
  label.position.y = box.height + 0.6;
  group.add(label);
  return group;
}

function portalGroup(
  portal: ReturnType<typeof worldZonePortalsIn>[number],
): THREE.Group {
  const group = new THREE.Group();
  group.name = portal.id;
  toScenePosition(portal.x, portal.y, 0, group.position);

  const gate = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.18, 12, 32, Math.PI),
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0x78350f,
      roughness: 0.5,
    }),
  );
  // Bogen steht quer zur Laufrichtung (Ost/West-Ausgang).
  gate.rotation.y = Math.PI / 2;
  group.add(gate);
  group.add(
    groundRing(portal.interactionRange * WORLD_UNIT_METERS, 0xfbbf24, 0.5),
  );

  const label = createLabel(portal.label, {
    color: '#fef3c7',
    background: 'rgba(120, 53, 15, 0.85)',
  });
  label.position.y = 2.2;
  group.add(label);
  return group;
}

/**
 * Grey-Box einer Zone: Boden, Collider als Blöcke, Interaktionsobjekte und
 * Portale. Reine Darstellung der gemeinsamen Geometrie aus
 * `@city/game-protocol`; begehbar ist, was der Server entscheidet.
 */
export function buildZoneGreybox(zoneId: WorldZoneId): THREE.Group {
  const style = ZONE_STYLES[zoneId];
  const zone = new THREE.Group();
  zone.name = `zone:${zoneId}`;

  const surroundings = new THREE.Mesh(
    new THREE.PlaneGeometry(ZONE_SIZE_METERS * 6, ZONE_SIZE_METERS * 6),
    new THREE.MeshStandardMaterial({ color: style.surroundings, roughness: 1 }),
  );
  surroundings.rotation.x = -Math.PI / 2;
  surroundings.position.y = -0.02;
  zone.add(surroundings);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ZONE_SIZE_METERS, ZONE_SIZE_METERS),
    new THREE.MeshStandardMaterial({ color: style.ground, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  zone.add(ground);

  for (const collider of worldZoneColliders(zoneId)) {
    zone.add(colliderMesh(collider));
  }
  for (const object of worldInteractionObjectsIn(zoneId)) {
    zone.add(interactionObjectGroup(object));
  }
  for (const portal of worldZonePortalsIn(zoneId)) {
    zone.add(portalGroup(portal));
  }
  return zone;
}

/**
 * Entfernt die DOM-Elemente aller Labels eines Teilbaums. CSS2DObject räumt
 * sein Element nur auf, wenn es selbst entfernt wird, nicht als Kind einer
 * entfernten Gruppe.
 */
export function detachLabels(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof CSS2DObject) object.element.remove();
  });
}

/** Gibt Geometrien, Materialien und Labels eines Teilbaums frei. */
export function disposeObject(root: THREE.Object3D): void {
  detachLabels(root);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) material.dispose();
  });
}

/** Fremde Entities laufen so weit hinter dem Server her (Interpolation). */
export const INTERPOLATION_DELAY_MS = 100;
const TICK_MS = WORLD_TICK_SECONDS * 1000;
/** Längste Anlauframpe nach einer Pause zwischen zwei Server-Ständen. */
const MAX_RAMP_MS = 250;
const MAX_SAMPLES = 20;

interface PositionSample {
  readonly t: number;
  readonly x: number;
  readonly z: number;
}

interface EntityAvatar {
  readonly group: THREE.Group;
  readonly body: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshStandardMaterial>;
  readonly ring: THREE.Mesh;
  readonly label: CSS2DObject;
  readonly samples: PositionSample[];
}

const AVATAR_COLORS = {
  self: 0x38bdf8,
  other: 0xa78bfa,
  npc: 0xf59e0b,
} as const;

/**
 * Spiegelt Entities als Kapseln. Fremde Entities werden zwischen bestätigten
 * Server-Ständen interpoliert; die eigene Figur setzt die Engine aus der
 * Client-Prediction.
 */
export class EntityLayer {
  readonly root = new THREE.Group();
  private readonly avatars = new Map<string, EntityAvatar>();
  private readonly bodyGeometry = new THREE.CapsuleGeometry(0.35, 1, 4, 16);
  private readonly ringGeometry = new THREE.TorusGeometry(0.7, 0.06, 8, 32);
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
  });

  constructor() {
    this.root.name = 'entities';
  }

  /** Position der Entity in der Szene, sofern sie sichtbar ist. */
  positionOf(characterId: string): THREE.Vector3 | null {
    return this.avatars.get(characterId)?.group.position ?? null;
  }

  sync(
    entities: readonly WorldEntity[],
    selfCharacterId: string | null,
    snap: boolean,
    nowMs: number,
  ): void {
    const currentIds = new Set(entities.map((entity) => entity.characterId));
    for (const [characterId, avatar] of this.avatars) {
      if (currentIds.has(characterId)) continue;
      this.root.remove(avatar.group);
      detachLabels(avatar.group);
      avatar.body.material.dispose();
      this.avatars.delete(characterId);
    }

    for (const entity of entities) {
      const existing = this.avatars.get(entity.characterId);
      const avatar = existing ?? this.createAvatar(entity);
      const isNpc = entity.kind === 'npc';
      const isSelf = !isNpc && entity.characterId === selfCharacterId;

      const target = toScenePosition(entity.x, entity.y);
      if (!existing || snap) {
        avatar.samples.length = 0;
        avatar.group.position.copy(target);
      }
      pushSample(avatar.samples, nowMs, target.x, target.z);

      avatar.body.material.color.setHex(
        isNpc
          ? AVATAR_COLORS.npc
          : isSelf
            ? AVATAR_COLORS.self
            : AVATAR_COLORS.other,
      );
      avatar.ring.visible = entity.interaction !== null;
      avatar.label.element.textContent = isNpc
        ? `${entity.name} (NPC)`
        : entity.name;
    }
  }

  /**
   * Setzt die Darstellungspositionen: die eigene Figur aus der Prediction,
   * alle anderen interpoliert `INTERPOLATION_DELAY_MS` hinter dem Server.
   */
  update(
    nowMs: number,
    selfCharacterId: string | null,
    selfPosition: WorldPoint | null,
  ): void {
    for (const [characterId, avatar] of this.avatars) {
      if (characterId === selfCharacterId && selfPosition) {
        toScenePosition(
          selfPosition.x,
          selfPosition.y,
          0,
          avatar.group.position,
        );
        continue;
      }
      interpolate(avatar.samples, nowMs - INTERPOLATION_DELAY_MS, avatar.group);
    }
  }

  dispose(): void {
    for (const avatar of this.avatars.values()) {
      this.root.remove(avatar.group);
      detachLabels(avatar.group);
      avatar.body.material.dispose();
    }
    this.avatars.clear();
    this.bodyGeometry.dispose();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
  }

  private createAvatar(entity: WorldEntity): EntityAvatar {
    const group = new THREE.Group();
    group.name = `entity:${entity.characterId}`;

    const body = new THREE.Mesh(
      this.bodyGeometry,
      new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    );
    body.position.y = 0.85;
    group.add(body);

    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    const label = createLabel(entity.name, {
      color: entity.kind === 'npc' ? '#fde68a' : '#f8fafc',
    });
    label.position.y = 2.1;
    group.add(label);

    const avatar = { group, body, ring, label, samples: [] };
    this.avatars.set(entity.characterId, avatar);
    this.root.add(group);
    return avatar;
  }
}

function pushSample(
  samples: PositionSample[],
  nowMs: number,
  x: number,
  z: number,
): void {
  const last = samples.at(-1);
  if (last && last.x === x && last.z === z) return;
  // Nach einer Pause sanft anlaufen statt zum neuen Stand zu springen.
  if (last && nowMs - last.t > 2 * TICK_MS) {
    const ramp = Math.min(nowMs - last.t, MAX_RAMP_MS);
    samples.push({ t: nowMs - ramp, x: last.x, z: last.z });
  }
  samples.push({ t: nowMs, x, z });
  if (samples.length > MAX_SAMPLES)
    samples.splice(0, samples.length - MAX_SAMPLES);
}

function interpolate(
  samples: readonly PositionSample[],
  renderTime: number,
  object: THREE.Object3D,
): void {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) return;
  if (renderTime <= first.t) {
    object.position.set(first.x, 0, first.z);
    return;
  }
  if (renderTime >= last.t) {
    object.position.set(last.x, 0, last.z);
    return;
  }
  for (let index = samples.length - 1; index > 0; index -= 1) {
    const from = samples[index - 1];
    const to = samples[index];
    if (!from || !to || renderTime < from.t) continue;
    const fraction = (renderTime - from.t) / (to.t - from.t);
    object.position.set(
      from.x + (to.x - from.x) * fraction,
      0,
      from.z + (to.z - from.z) * fraction,
    );
    return;
  }
}
