import Phaser from 'phaser';
import {
  CENTRAL_SQUARE_COLLIDERS,
  WORLD_ZONE_ID,
  worldInteractionObject,
  worldInteractionObjectsIn,
  type WorldCircleCollider,
  type WorldInteractionObjectId,
  type WorldRectangleCollider,
} from '@city/game-protocol';
import { ensureCentralSquareTextures } from './central-square-textures';
import {
  WORLD_MAP_BOUNDS,
  WORLD_MAP_ENTITY_INSET,
  WORLD_VIEWPORT,
  createZoneMapTracker,
  renderZonePortals,
  worldMapRangeToPixels,
  worldMapX,
  worldMapY,
  type ZoneMapHandle,
} from './world-map-layout';

/** @deprecated Prefer WORLD_VIEWPORT — kept for existing imports. */
export const CENTRAL_SQUARE_VIEWPORT = WORLD_VIEWPORT;
/** @deprecated Prefer WORLD_MAP_BOUNDS — kept for existing imports. */
export const CENTRAL_SQUARE_BOUNDS = WORLD_MAP_BOUNDS;
/** @deprecated Prefer WORLD_MAP_ENTITY_INSET — kept for existing imports. */
export const CENTRAL_SQUARE_ENTITY_INSET = WORLD_MAP_ENTITY_INSET;

interface Building {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly roof: number;
}

const BUILDING_ROOFS = [0x9b5545, 0x725066, 0x6d5945, 0x526656] as const;
const BUILDING_COLLIDERS = CENTRAL_SQUARE_COLLIDERS.filter(
  (collider): collider is WorldRectangleCollider =>
    collider.kind === 'rectangle',
);
const FOUNTAIN_COLLIDER = CENTRAL_SQUARE_COLLIDERS.find(
  (collider): collider is WorldCircleCollider =>
    collider.id === 'central-fountain' && collider.kind === 'circle',
);

const BUILDINGS: readonly Building[] = BUILDING_COLLIDERS.map(
  (collider, index) => ({
    x: worldMapX(collider.minX),
    y: worldMapY(collider.minY),
    width: worldMapX(collider.maxX) - worldMapX(collider.minX),
    height: worldMapY(collider.maxY) - worldMapY(collider.minY),
    roof: BUILDING_ROOFS[index] ?? 0x725066,
  }),
);

const TREES: readonly [number, number][] = [
  [274, 95],
  [526, 95],
  [274, 355],
  [526, 355],
  [118, 190],
  [682, 190],
  [118, 260],
  [682, 260],
];

/**
 * Static, decorative map projection. It deliberately owns no entities or
 * movement rules; those continue to be projected from confirmed world state.
 */
export function renderCentralSquare(scene: Phaser.Scene): ZoneMapHandle {
  ensureCentralSquareTextures(scene);
  const { track, handle } = createZoneMapTracker();
  const map = track(scene.add.graphics().setDepth(2));
  const textured = scene.textures.exists('cs-grass');

  // Soft frame behind tiled world.
  map.fillStyle(0x243528);
  map.fillRoundedRect(32, 20, 736, 410, 18);

  // Tiled lawn, paths, plaza (art pass — not flat debug fills).
  if (textured) {
    track(scene.add.tileSprite(400, 225, 720, 394, 'cs-grass').setDepth(0));
    track(scene.add.tileSprite(400, 225, 96, 394, 'cs-path').setDepth(1));
    track(scene.add.tileSprite(400, 225, 720, 96, 'cs-path').setDepth(1));
    track(scene.add.tileSprite(400, 225, 292, 206, 'cs-plaza').setDepth(1));
  } else {
    map.fillStyle(0x5f7f54);
    map.fillRoundedRect(40, 28, 720, 394, 16);
    map.fillStyle(0xd2c2a0);
    map.fillRect(352, 28, 96, 394);
    map.fillRect(40, 177, 720, 96);
    map.fillStyle(0xe0d3b6);
    map.fillRoundedRect(254, 122, 292, 206, 20);
  }
  map.lineStyle(4, 0x8f7558, 0.85);
  map.strokeRoundedRect(254, 122, 292, 206, 18);

  for (const building of BUILDINGS)
    drawBuilding(scene, map, building, textured, track);
  for (const [x, y] of TREES) drawTree(map, x, y);

  // Central fountain and four benches give the square a recognizable focus.
  // The fountain position and footprint come from the shared collision model.
  const fountainX = worldMapX(FOUNTAIN_COLLIDER?.x ?? 50);
  const fountainY = worldMapY(FOUNTAIN_COLLIDER?.y ?? 50);
  const fountainRadius = worldMapRangeToPixels(FOUNTAIN_COLLIDER?.radius ?? 7);
  map.fillStyle(0x746b62);
  map.fillCircle(fountainX, fountainY, fountainRadius);
  map.fillStyle(0x75b8c7);
  map.fillCircle(fountainX, fountainY, fountainRadius * 0.8);
  map.fillStyle(0xb8e3e7);
  map.fillCircle(fountainX, fountainY, fountainRadius * 0.27);
  map.lineStyle(3, 0xd9f2ef, 0.8);
  map.strokeCircle(fountainX, fountainY, fountainRadius * 0.56);

  map.fillStyle(0x604b38);
  map.fillRoundedRect(290, 151, 58, 9, 3);
  map.fillRoundedRect(452, 290, 58, 9, 3);
  map.fillRoundedRect(289, 290, 9, 45, 3);
  map.fillRoundedRect(502, 115, 9, 45, 3);

  const drawPoi = (
    objectId: WorldInteractionObjectId,
    fill: number,
    stroke: number,
    label: string,
    labelColor: string,
    labelStroke: string,
    width: number,
    height: number,
  ): void => {
    const object = worldInteractionObject(objectId);
    const x = worldMapX(object.x);
    const y = worldMapY(object.y);
    const radius = worldMapRangeToPixels(object.interactionRange);
    map.lineStyle(2, stroke, 0.28);
    map.strokeCircle(x, y, radius);
    map.fillStyle(fill, 0.96);
    map.fillRoundedRect(x - width / 2, y - height / 2, width, height, 5);
    map.lineStyle(3, stroke, 0.95);
    map.strokeRoundedRect(x - width / 2, y - height / 2, width, height, 5);
    track(
      scene.add
        .text(x, y + height / 2 + 12, label, {
          color: labelColor,
          fontFamily: 'system-ui, sans-serif',
          fontSize: '11px',
          fontStyle: 'bold',
          stroke: labelStroke,
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(2),
    );
  };

  drawPoi(
    'bench-south',
    0x604b38,
    0xfacc15,
    'REST',
    '#fef3c7',
    '#3f2d18',
    62,
    18,
  );
  drawPoi(
    'kiosk-north',
    0x334155,
    0x38bdf8,
    'JOB',
    '#e0f2fe',
    '#0f172a',
    56,
    32,
  );
  drawPoi(
    'snack-east',
    0x7c2d12,
    0xfbbf24,
    'SHOP',
    '#fff7ed',
    '#431407',
    52,
    28,
  );

  // Soft wayfinding ticks from plaza center toward POIs (spatial cue only).
  const plazaX = worldMapX(50);
  const plazaY = worldMapY(58);
  map.lineStyle(3, 0xf8fafc, 0.22);
  for (const object of worldInteractionObjectsIn(WORLD_ZONE_ID)) {
    map.lineBetween(plazaX, plazaY, worldMapX(object.x), worldMapY(object.y));
  }

  track(
    scene.add
      .text(400, 72, 'CENTRAL SQUARE', {
        color: '#f7ecd0',
        fontFamily: 'Georgia, serif',
        fontSize: '19px',
        fontStyle: 'bold',
        stroke: '#47392f',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(1),
  );

  renderZonePortals(scene, WORLD_ZONE_ID, track);
  return handle;
}

function drawBuilding(
  scene: Phaser.Scene,
  graphics: Phaser.GameObjects.Graphics,
  building: Building,
  textured: boolean,
  track: <T extends Phaser.GameObjects.GameObject>(object: T) => T,
): void {
  graphics.fillStyle(0x1f1712, 0.35);
  graphics.fillRoundedRect(
    building.x + 6,
    building.y + 8,
    building.width,
    building.height,
    5,
  );
  if (textured) {
    track(
      scene.add
        .tileSprite(
          building.x + building.width / 2,
          building.y + building.height / 2,
          building.width,
          building.height,
          'cs-wall',
        )
        .setDepth(2),
    );
    track(
      scene.add
        .tileSprite(
          building.x + building.width / 2,
          building.y - 2,
          building.width + 10,
          18,
          'cs-roof',
        )
        .setTint(building.roof)
        .setDepth(3),
    );
  } else {
    graphics.fillStyle(0xe2c99f);
    graphics.fillRoundedRect(
      building.x,
      building.y,
      building.width,
      building.height,
      5,
    );
    graphics.fillStyle(building.roof);
    graphics.fillRect(building.x - 4, building.y - 5, building.width + 8, 24);
  }
  graphics.fillStyle(0x3b2d26);
  graphics.fillRect(
    building.x + building.width / 2 - 10,
    building.y + building.height - 26,
    20,
    26,
  );
}

function drawTree(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
): void {
  graphics.fillStyle(0x0f172a, 0.2);
  graphics.fillEllipse(x + 2, y + 14, 22, 8);
  graphics.fillStyle(0x5b4030);
  graphics.fillRect(x - 3, y, 6, 18);
  graphics.fillStyle(0x245536);
  graphics.fillCircle(x, y - 8, 18);
  graphics.fillStyle(0x367448);
  graphics.fillCircle(x - 9, y - 12, 11);
  graphics.fillCircle(x + 10, y - 10, 12);
  graphics.fillStyle(0x52a05f, 0.85);
  graphics.fillCircle(x + 2, y - 16, 8);
}
