import Phaser from 'phaser';

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

const BUILDINGS: readonly Building[] = [
  { x: 62, y: 48, width: 174, height: 74, roof: 0x9b5545 },
  { x: 564, y: 48, width: 174, height: 74, roof: 0x725066 },
  { x: 62, y: 328, width: 174, height: 74, roof: 0x6d5945 },
  { x: 564, y: 328, width: 174, height: 74, roof: 0x526656 },
];

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
  map.fillStyle(0x746b62);
  map.fillCircle(400, 225, 45);
  map.fillStyle(0x75b8c7);
  map.fillCircle(400, 225, 36);
  map.fillStyle(0xb8e3e7);
  map.fillCircle(400, 225, 12);
  map.lineStyle(3, 0xd9f2ef, 0.8);
  map.strokeCircle(400, 225, 25);

  map.fillStyle(0x604b38);
  map.fillRoundedRect(290, 151, 58, 9, 3);
  map.fillRoundedRect(452, 290, 58, 9, 3);
  map.fillRoundedRect(289, 290, 9, 45, 3);
  map.fillRoundedRect(502, 115, 9, 45, 3);

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
