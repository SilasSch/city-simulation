import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  MARKET_LANE_ZONE_ID,
  WORLD_COORDINATE_MAX,
  WORLD_COORDINATE_MIN,
  WORLD_ZONE_ID,
  worldInteractionObjectsIn,
  worldZoneColliders,
  worldZonePortalsIn,
} from '@city/game-protocol';
import type {
  WorldCollider,
  WorldEntity,
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

/** Gibt Geometrien und Materialien eines Teilbaums frei. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) material.dispose();
  });
}

interface EntityAvatar {
  readonly group: THREE.Group;
  readonly body: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshStandardMaterial>;
  readonly ring: THREE.Mesh;
  readonly label: CSS2DObject;
  readonly target: THREE.Vector3;
}

const AVATAR_COLORS = {
  self: 0x38bdf8,
  other: 0xa78bfa,
  npc: 0xf59e0b,
} as const;

/**
 * Spiegelt bestätigte Entities als Kapseln. Bewegt wird nur visuell in
 * Richtung der vom Server bestätigten Position; keine optimistische Mutation.
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
  ): void {
    const currentIds = new Set(entities.map((entity) => entity.characterId));
    for (const [characterId, avatar] of this.avatars) {
      if (currentIds.has(characterId)) continue;
      this.root.remove(avatar.group);
      avatar.body.material.dispose();
      this.avatars.delete(characterId);
    }

    for (const entity of entities) {
      const existing = this.avatars.get(entity.characterId);
      const avatar = existing ?? this.createAvatar(entity);
      const isNpc = entity.kind === 'npc';
      const isSelf = !isNpc && entity.characterId === selfCharacterId;

      toScenePosition(entity.x, entity.y, 0, avatar.target);
      if (!existing || snap) avatar.group.position.copy(avatar.target);

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

  /** Gleitet sichtbar zur bestätigten Position (Schritte wirken nicht ruckartig). */
  update(deltaSeconds: number): void {
    const blend = 1 - Math.exp(-deltaSeconds * 12);
    for (const avatar of this.avatars.values()) {
      avatar.group.position.lerp(avatar.target, blend);
    }
  }

  dispose(): void {
    for (const avatar of this.avatars.values()) {
      this.root.remove(avatar.group);
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

    const avatar = { group, body, ring, label, target: new THREE.Vector3() };
    this.avatars.set(entity.characterId, avatar);
    this.root.add(group);
    return avatar;
  }
}
