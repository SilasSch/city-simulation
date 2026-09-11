import Phaser from 'phaser';
import {
  MARKET_LANE_COLLIDERS,
  MARKET_LANE_ZONE_ID,
  worldInteractionObject,
  type WorldRectangleCollider,
} from '@city/game-protocol';
import { ensureMarketLaneTextures } from './market-lane-textures';
import {
  createZoneMapTracker,
  renderZonePortals,
  worldMapRangeToPixels,
  worldMapX,
  worldMapY,
  type ZoneMapHandle,
} from './world-map-layout';

const STALL_AWNINGS = [0xb45309, 0x9f1239, 0x1d4ed8, 0x15803d] as const;

const STALL_COLLIDERS = MARKET_LANE_COLLIDERS.filter(
  (collider): collider is WorldRectangleCollider =>
    collider.kind === 'rectangle' && collider.id.startsWith('stall-'),
);

const CRATE_COLLIDERS = MARKET_LANE_COLLIDERS.filter(
  (collider): collider is WorldRectangleCollider =>
    collider.kind === 'rectangle' && collider.id.startsWith('crate-'),
);

/**
 * Static Market Lane projection. Owns no entities or movement rules — those
 * stay snapshot-driven from confirmed world state.
 */
export function renderMarketLane(scene: Phaser.Scene): ZoneMapHandle {
  ensureMarketLaneTextures(scene);
  const { track, handle } = createZoneMapTracker();
  const map = track(scene.add.graphics().setDepth(2));
  const textured = scene.textures.exists('ml-cobble');

  // Warm timber frame — reads darker/warmer than Central Square's soft green.
  map.fillStyle(0x3b2a1a);
  map.fillRoundedRect(32, 20, 736, 410, 18);

  if (textured) {
    track(scene.add.tileSprite(400, 225, 720, 394, 'ml-dirt').setDepth(0));
    // Central walkable lane (horizontal + vertical market street).
    track(scene.add.tileSprite(400, 225, 220, 394, 'ml-cobble').setDepth(1));
    track(scene.add.tileSprite(400, 225, 720, 140, 'ml-cobble').setDepth(1));
  } else {
    map.fillStyle(0x6d5438);
    map.fillRoundedRect(40, 28, 720, 394, 16);
    map.fillStyle(0x8a7355);
    map.fillRect(290, 28, 220, 394);
    map.fillRect(40, 155, 720, 140);
  }

  // Soft lane edge lines for wayfinding.
  map.lineStyle(3, 0xd6b98a, 0.35);
  map.strokeRect(290, 28, 220, 394);
  map.strokeRect(40, 155, 720, 140);

  STALL_COLLIDERS.forEach((collider, index) => {
    drawStall(
      scene,
      map,
      collider,
      STALL_AWNINGS[index] ?? 0xb45309,
      textured,
      track,
    );
  });
  for (const collider of CRATE_COLLIDERS) {
    drawCrate(scene, map, collider, textured, track);
  }

  // Scattered barrel/produce accents along the lane (decorative only).
  drawBarrel(map, worldMapX(42), worldMapY(30));
  drawBarrel(map, worldMapX(58), worldMapY(72));
  drawProduce(map, worldMapX(48), worldMapY(28));
  drawProduce(map, worldMapX(52), worldMapY(74));

  track(
    scene.add
      .text(400, 72, 'MARKTGASSE', {
        color: '#fde68a',
        fontFamily: 'Georgia, serif',
        fontSize: '19px',
        fontStyle: 'bold',
        stroke: '#451a03',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(1),
  );

  drawStallJobPoi(scene, map, track);

  renderZonePortals(scene, MARKET_LANE_ZONE_ID, track);
  return handle;
}

function drawStallJobPoi(
  scene: Phaser.Scene,
  graphics: Phaser.GameObjects.Graphics,
  track: <T extends Phaser.GameObjects.GameObject>(object: T) => T,
): void {
  const object = worldInteractionObject('stall-north');
  const x = worldMapX(object.x);
  const y = worldMapY(object.y);
  const radius = worldMapRangeToPixels(object.interactionRange);
  const width = 56;
  const height = 28;

  graphics.lineStyle(2, 0xfbbf24, 0.28);
  graphics.strokeCircle(x, y, radius);
  graphics.fillStyle(0x7c2d12, 0.96);
  graphics.fillRoundedRect(x - width / 2, y - height / 2, width, height, 5);
  graphics.lineStyle(3, 0xfbbf24, 0.95);
  graphics.strokeRoundedRect(x - width / 2, y - height / 2, width, height, 5);
  track(
    scene.add
      .text(x, y + height / 2 + 12, 'JOB', {
        color: '#fff7ed',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        stroke: '#431407',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(2),
  );
}

function drawStall(
  scene: Phaser.Scene,
  graphics: Phaser.GameObjects.Graphics,
  collider: WorldRectangleCollider,
  awningTint: number,
  textured: boolean,
  track: <T extends Phaser.GameObjects.GameObject>(object: T) => T,
): void {
  const x = worldMapX(collider.minX);
  const y = worldMapY(collider.minY);
  const width = worldMapX(collider.maxX) - x;
  const height = worldMapY(collider.maxY) - y;

  graphics.fillStyle(0x1c120a, 0.35);
  graphics.fillRoundedRect(x + 5, y + 7, width, height, 4);

  if (textured) {
    track(
      scene.add
        .tileSprite(x + width / 2, y + height / 2, width, height, 'ml-stall')
        .setDepth(2),
    );
    track(
      scene.add
        .tileSprite(x + width / 2, y - 2, width + 12, 18, 'ml-awning')
        .setTint(awningTint)
        .setDepth(3),
    );
  } else {
    graphics.fillStyle(0xc4a574);
    graphics.fillRoundedRect(x, y, width, height, 4);
    graphics.fillStyle(awningTint);
    graphics.fillRect(x - 5, y - 6, width + 10, 18);
    graphics.fillStyle(0xfbbf24, 0.55);
    for (let stripe = x; stripe < x + width; stripe += 14) {
      graphics.fillRect(stripe, y - 6, 7, 18);
    }
  }

  // Counter shelf silhouette.
  graphics.fillStyle(0x5b3a1a);
  graphics.fillRect(x + 8, y + height - 18, width - 16, 10);
}

function drawCrate(
  scene: Phaser.Scene,
  graphics: Phaser.GameObjects.Graphics,
  collider: WorldRectangleCollider,
  textured: boolean,
  track: <T extends Phaser.GameObjects.GameObject>(object: T) => T,
): void {
  const x = worldMapX(collider.minX);
  const y = worldMapY(collider.minY);
  const width = worldMapX(collider.maxX) - x;
  const height = worldMapY(collider.maxY) - y;

  graphics.fillStyle(0x1c120a, 0.3);
  graphics.fillRect(x + 3, y + 4, width, height);

  if (textured) {
    track(
      scene.add
        .tileSprite(x + width / 2, y + height / 2, width, height, 'ml-crate')
        .setDepth(2),
    );
  } else {
    graphics.fillStyle(0xa16207);
    graphics.fillRect(x, y, width, height);
    graphics.lineStyle(2, 0x713f12, 0.95);
    graphics.strokeRect(x, y, width, height);
    graphics.lineStyle(2, 0x854d0e, 0.8);
    graphics.lineBetween(x, y + height / 2, x + width, y + height / 2);
    graphics.lineBetween(x + width / 2, y, x + width / 2, y + height);
  }
}

function drawBarrel(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
): void {
  graphics.fillStyle(0x0f172a, 0.2);
  graphics.fillEllipse(x + 2, y + 10, 18, 7);
  graphics.fillStyle(0x7c4a1e);
  graphics.fillEllipse(x, y, 16, 20);
  graphics.fillStyle(0x5b3412);
  graphics.fillRect(x - 8, y - 3, 16, 3);
  graphics.fillRect(x - 8, y + 4, 16, 3);
  graphics.fillStyle(0xd6b98a, 0.5);
  graphics.fillEllipse(x, y - 8, 12, 5);
}

function drawProduce(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
): void {
  graphics.fillStyle(0xdc2626, 0.9);
  graphics.fillCircle(x - 5, y, 5);
  graphics.fillStyle(0xca8a04, 0.9);
  graphics.fillCircle(x + 4, y - 2, 4);
  graphics.fillStyle(0x16a34a, 0.9);
  graphics.fillCircle(x + 1, y + 5, 4);
}
