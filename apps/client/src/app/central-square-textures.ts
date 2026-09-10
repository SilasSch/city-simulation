import Phaser from 'phaser';

/** Procedural, license-free textures for the Central Square art pass. */
export function ensureCentralSquareTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('cs-grass')) return;

  paint(scene, 'cs-grass', 32, 32, (g) => {
    g.fillStyle(0x5a7a4f);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x6b8d5c, 0.55);
    for (let i = 0; i < 18; i++) {
      const x = (i * 7) % 32;
      const y = (i * 11) % 32;
      g.fillRect(x, y, 2, 3);
    }
    g.fillStyle(0x4a6841, 0.35);
    g.fillRect(4, 8, 1, 4);
    g.fillRect(20, 18, 1, 5);
  });

  paint(scene, 'cs-path', 32, 32, (g) => {
    g.fillStyle(0xc9b896);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0xb9a782, 0.7);
    g.fillRect(0, 0, 32, 2);
    g.fillRect(0, 16, 32, 2);
    g.fillStyle(0xd8c9a8, 0.5);
    g.fillRect(8, 4, 6, 8);
    g.fillRect(20, 18, 7, 7);
  });

  paint(scene, 'cs-plaza', 32, 32, (g) => {
    g.fillStyle(0xdccfb4);
    g.fillRect(0, 0, 32, 32);
    g.lineStyle(1, 0xc2b396, 0.8);
    g.strokeRect(0.5, 0.5, 31, 31);
    g.fillStyle(0xe8ddc6, 0.45);
    g.fillRect(2, 2, 12, 12);
    g.fillRect(18, 18, 10, 10);
  });

  paint(scene, 'cs-wall', 32, 32, (g) => {
    g.fillStyle(0xe6d2ad);
    g.fillRect(0, 0, 32, 32);
    g.lineStyle(1, 0xcbb892, 0.9);
    g.strokeRect(0.5, 0.5, 31, 15);
    g.strokeRect(0.5, 16.5, 31, 15);
    g.fillStyle(0x91b8bf);
    g.fillRect(8, 4, 8, 6);
    g.fillRect(20, 20, 8, 6);
  });

  paint(scene, 'cs-roof', 32, 16, (g) => {
    g.fillStyle(0x8a4f42);
    g.fillRect(0, 0, 32, 16);
    g.fillStyle(0x6e3d34, 0.55);
    for (let x = 0; x < 32; x += 4) g.fillRect(x, 0, 2, 16);
  });

  paint(scene, 'cs-character-self', 20, 28, (g) => {
    g.fillStyle(0x0f172a, 0.25);
    g.fillEllipse(10, 25, 12, 5);
    g.fillStyle(0x38bdf8);
    g.fillRoundedRect(5, 10, 10, 12, 3);
    g.fillStyle(0xfde68a);
    g.fillCircle(10, 7, 5);
    g.fillStyle(0x0ea5e9);
    g.fillRect(4, 14, 3, 7);
    g.fillRect(13, 14, 3, 7);
  });

  paint(scene, 'cs-character-other', 20, 28, (g) => {
    g.fillStyle(0x0f172a, 0.25);
    g.fillEllipse(10, 25, 12, 5);
    g.fillStyle(0xa78bfa);
    g.fillRoundedRect(5, 10, 10, 12, 3);
    g.fillStyle(0xf5d0fe);
    g.fillCircle(10, 7, 5);
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
  draw(g);
  g.generateTexture(key, width, height);
  g.destroy();
}
