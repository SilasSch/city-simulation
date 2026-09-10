import Phaser from 'phaser';

/** Procedural, license-free textures for the Market Lane art pass. */
export function ensureMarketLaneTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('ml-cobble')) return;

  paint(scene, 'ml-cobble', 32, 32, (g) => {
    g.fillStyle(0x8a7355);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x9a8363, 0.7);
    g.fillRect(1, 1, 14, 14);
    g.fillRect(17, 17, 14, 14);
    g.fillStyle(0x7a6548, 0.55);
    g.fillRect(17, 1, 14, 14);
    g.fillRect(1, 17, 14, 14);
    g.lineStyle(1, 0x6b563c, 0.65);
    g.strokeRect(0.5, 0.5, 15, 15);
    g.strokeRect(16.5, 16.5, 15, 15);
  });

  paint(scene, 'ml-dirt', 32, 32, (g) => {
    g.fillStyle(0x6d5438);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x7d6446, 0.5);
    for (let i = 0; i < 14; i++) {
      const x = (i * 9) % 32;
      const y = (i * 13) % 32;
      g.fillRect(x, y, 3, 2);
    }
    g.fillStyle(0x5a452c, 0.35);
    g.fillRect(10, 6, 2, 5);
    g.fillRect(22, 20, 2, 4);
  });

  paint(scene, 'ml-awning', 32, 16, (g) => {
    g.fillStyle(0xb45309);
    g.fillRect(0, 0, 32, 16);
    g.fillStyle(0xfbbf24, 0.85);
    for (let x = 0; x < 32; x += 8) g.fillRect(x, 0, 4, 16);
    g.fillStyle(0x78350f, 0.5);
    g.fillRect(0, 12, 32, 4);
  });

  paint(scene, 'ml-stall', 32, 32, (g) => {
    g.fillStyle(0xc4a574);
    g.fillRect(0, 0, 32, 32);
    g.lineStyle(1, 0x8b6914, 0.8);
    g.strokeRect(0.5, 0.5, 31, 31);
    g.fillStyle(0x92400e, 0.45);
    g.fillRect(4, 8, 24, 4);
    g.fillRect(4, 18, 24, 4);
    g.fillStyle(0xdc2626, 0.7);
    g.fillCircle(10, 14, 3);
    g.fillStyle(0x16a34a, 0.7);
    g.fillCircle(22, 22, 3);
  });

  paint(scene, 'ml-crate', 16, 16, (g) => {
    g.fillStyle(0xa16207);
    g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, 0x713f12, 0.9);
    g.strokeRect(0.5, 0.5, 15, 15);
    g.fillStyle(0x854d0e, 0.7);
    g.fillRect(0, 7, 16, 2);
    g.fillRect(7, 0, 2, 16);
  });
}

function paint(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (graphics: Phaser.GameObjects.Graphics) => void,
): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  try {
    draw(g);
    // HEADLESS/canvas test boots cannot always rasterize textures.
    g.generateTexture(key, width, height);
  } catch {
    // Leave texture missing; renderers fall back to solid graphics.
  } finally {
    g.destroy();
  }
}
