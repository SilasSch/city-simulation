import Phaser from 'phaser';
import {
  CENTRAL_SQUARE_COLLIDERS,
  WORLD_COORDINATE_MAX,
  WORLD_INTERACTION_OBJECTS,
  type WorldCircleCollider,
  type WorldRectangleCollider,
} from '@city/game-protocol';

export const CENTRAL_SQUARE_VIEWPORT = {
  width: 800,
  height: 450,
} as const;

export const CENTRAL_SQUARE_BOUNDS = new Phaser.Geom.Rectangle(
  40,
  28,
  720,
  394,
);
export const CENTRAL_SQUARE_ENTITY_INSET = 26;

interface Building {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly roof: number;
}

const MAP_CONTENT = { x: 62, y: 48, width: 676, height: 354 } as const;
const BUILDING_ROOFS = [0x9b5545, 0x725066, 0x6d5945, 0x526656] as const;
const BUILDING_COLLIDERS = CENTRAL_SQUARE_COLLIDERS.filter(
  (collider): collider is WorldRectangleCollider =>
    collider.kind === 'rectangle',
);
const FOUNTAIN_COLLIDER = CENTRAL_SQUARE_COLLIDERS.find(
  (collider): collider is WorldCircleCollider =>
    collider.id === 'central-fountain' && collider.kind === 'circle',
);

function mapX(value: number): number {
  return MAP_CONTENT.x + (value / WORLD_COORDINATE_MAX) * MAP_CONTENT.width;
}

function mapY(value: number): number {
  return MAP_CONTENT.y + (value / WORLD_COORDINATE_MAX) * MAP_CONTENT.height;
}

const BUILDINGS: readonly Building[] = BUILDING_COLLIDERS.map(
  (collider, index) => ({
    x: mapX(collider.minX),
    y: mapY(collider.minY),
    width: mapX(collider.maxX) - mapX(collider.minX),
    height: mapY(collider.maxY) - mapY(collider.minY),
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
export function renderCentralSquare(scene: Phaser.Scene): void {
  const map = scene.add.graphics().setDepth(0);

  // Park perimeter and the four broad pedestrian approaches.
  map.fillStyle(0x6d8b61);
  map.fillRoundedRect(40, 28, 720, 394, 16);
  map.fillStyle(0xc6b897);
  map.fillRect(352, 28, 96, 394);
  map.fillRect(40, 177, 720, 96);

  // The stone civic plaza, framed by a warm cobble border.
  map.fillStyle(0xa98f6e);
  map.fillRoundedRect(244, 112, 312, 226, 24);
  map.fillStyle(0xd4c8aa);
  map.fillRoundedRect(254, 122, 292, 206, 20);
  map.lineStyle(2, 0xb9aa89, 0.65);
  for (let y = 142; y < 322; y += 24) map.lineBetween(260, y, 540, y);

  for (const building of BUILDINGS) drawBuilding(map, building);
  for (const [x, y] of TREES) drawTree(map, x, y);

  // Central fountain and four benches give the square a recognizable focus.
  // The fountain position and footprint come from the shared collision model.
  const fountainX = mapX(FOUNTAIN_COLLIDER?.x ?? 50);
  const fountainY = mapY(FOUNTAIN_COLLIDER?.y ?? 50);
  const fountainRadius =
    ((FOUNTAIN_COLLIDER?.radius ?? 7) / WORLD_COORDINATE_MAX) *
    MAP_CONTENT.width;
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

  const restBench = WORLD_INTERACTION_OBJECTS.find(
    (object) => object.id === 'bench-south',
  )!;
  const restBenchX = mapX(restBench.x);
  const restBenchY = mapY(restBench.y);
  map.lineStyle(3, 0xfacc15, 0.95);
  map.strokeRoundedRect(restBenchX - 31, restBenchY - 9, 62, 18, 5);
  scene.add
    .text(restBenchX, restBenchY + 13, 'REST', {
      color: '#fef3c7',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '10px',
      fontStyle: 'bold',
      stroke: '#3f2d18',
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setDepth(2);

  const jobKiosk = WORLD_INTERACTION_OBJECTS.find(
    (object) => object.id === 'kiosk-north',
  )!;
  const jobX = mapX(jobKiosk.x);
  const jobY = mapY(jobKiosk.y);
  map.fillStyle(0x334155, 0.95);
  map.fillRoundedRect(jobX - 28, jobY - 16, 56, 32, 4);
  map.lineStyle(3, 0x38bdf8, 0.95);
  map.strokeRoundedRect(jobX - 28, jobY - 16, 56, 32, 4);
  scene.add
    .text(jobX, jobY + 22, 'JOB', {
      color: '#e0f2fe',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '10px',
      fontStyle: 'bold',
      stroke: '#0f172a',
      strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setDepth(2);

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
    .setDepth(1);
}

function drawBuilding(
  graphics: Phaser.GameObjects.Graphics,
  building: Building,
): void {
  graphics.fillStyle(0x3d342e, 0.35);
  graphics.fillRoundedRect(
    building.x + 5,
    building.y + 7,
    building.width,
    building.height,
    5,
  );
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
  graphics.fillStyle(0x483a31);
  graphics.fillRect(
    building.x + building.width / 2 - 10,
    building.y + building.height - 25,
    20,
    25,
  );
  graphics.fillStyle(0x90b6bd);
  graphics.fillRect(building.x + 25, building.y + 35, 28, 18);
  graphics.fillRect(building.x + building.width - 53, building.y + 35, 28, 18);
}

function drawTree(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
): void {
  graphics.fillStyle(0x4f3c2c);
  graphics.fillRect(x - 3, y, 6, 16);
  graphics.fillStyle(0x315d3d);
  graphics.fillCircle(x, y - 6, 17);
  graphics.fillStyle(0x477a4b);
  graphics.fillCircle(x - 7, y - 10, 10);
  graphics.fillCircle(x + 8, y - 8, 11);
}
