import Phaser from 'phaser';
import {
  WORLD_COORDINATE_MAX,
  worldZonePortalsIn,
  type WorldZoneId,
} from '@city/game-protocol';

/** Shared 16:9 stage size used by every zone map. */
export const WORLD_VIEWPORT = {
  width: 800,
  height: 450,
} as const;

/** Playable rectangle inside the stage frame (entity projection). */
export const WORLD_MAP_BOUNDS = new Phaser.Geom.Rectangle(40, 28, 720, 394);
export const WORLD_MAP_ENTITY_INSET = 26;

/** Inner content area that maps logical 0..100 onto the stage. */
export const WORLD_MAP_CONTENT = {
  x: 62,
  y: 48,
  width: 676,
  height: 354,
} as const;

export function worldMapX(value: number): number {
  return (
    WORLD_MAP_CONTENT.x +
    (value / WORLD_COORDINATE_MAX) * WORLD_MAP_CONTENT.width
  );
}

export function worldMapY(value: number): number {
  return (
    WORLD_MAP_CONTENT.y +
    (value / WORLD_COORDINATE_MAX) * WORLD_MAP_CONTENT.height
  );
}

export function worldMapRangeToPixels(range: number): number {
  return (range / WORLD_COORDINATE_MAX) * WORLD_MAP_CONTENT.width;
}

/** Tracked display objects so zone swaps can tear down map art cleanly. */
export interface ZoneMapHandle {
  destroy(): void;
}

export function createZoneMapTracker(): {
  track: <T extends Phaser.GameObjects.GameObject>(object: T) => T;
  handle: ZoneMapHandle;
} {
  const objects: Phaser.GameObjects.GameObject[] = [];
  return {
    track: <T extends Phaser.GameObjects.GameObject>(object: T): T => {
      objects.push(object);
      return object;
    },
    handle: {
      destroy(): void {
        for (const object of objects) object.destroy();
        objects.length = 0;
      },
    },
  };
}

/**
 * Visual portal cues from WORLD_ZONE_PORTALS — presentation only; transition
 * still requires the confirmed snapshot after world-transition.
 */
export function renderZonePortals(
  scene: Phaser.Scene,
  zoneId: WorldZoneId,
  track: <T extends Phaser.GameObjects.GameObject>(object: T) => T,
): void {
  const graphics = track(scene.add.graphics().setDepth(4));

  for (const portal of worldZonePortalsIn(zoneId)) {
    const x = worldMapX(portal.x);
    const y = worldMapY(portal.y);
    const radius = worldMapRangeToPixels(portal.interactionRange);

    graphics.fillStyle(0xfbbf24, 0.16);
    graphics.fillCircle(x, y, radius);
    graphics.lineStyle(2, 0xf59e0b, 0.55);
    graphics.strokeCircle(x, y, radius);
    graphics.lineStyle(3, 0xfde68a, 0.95);
    graphics.strokeCircle(x, y, radius * 0.42);

    // Directional chevron toward the off-map exit.
    const facingEast = portal.x >= 50;
    const tipX = facingEast ? x + 14 : x - 14;
    graphics.fillStyle(0xfbbf24, 0.95);
    graphics.fillTriangle(
      tipX,
      y,
      facingEast ? tipX - 12 : tipX + 12,
      y - 9,
      facingEast ? tipX - 12 : tipX + 12,
      y + 9,
    );
    graphics.fillStyle(0x92400e, 0.9);
    graphics.fillRoundedRect(x - 10, y - 10, 20, 20, 4);

    track(
      scene.add
        .text(x, y - radius - 6, portal.label, {
          color: '#fef3c7',
          fontFamily: 'system-ui, sans-serif',
          fontSize: '11px',
          fontStyle: 'bold',
          stroke: '#78350f',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(5),
    );
  }
}
