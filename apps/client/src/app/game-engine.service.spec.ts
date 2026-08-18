import { describe, expect, it, beforeAll } from 'vitest';
import { worldDirectionForKey } from './world-input';

/**
 * jsdom liefert keinen echten 2D-Canvas-Kontext. Phaser führt bereits beim
 * Modul-Import Feature-Checks auf einem Canvas aus — daher minimaler Stub,
 * bevor das Modul dynamisch importiert wird.
 */
function stubCanvas2dContext(): void {
  const fakeContext = {
    fillStyle: '',
    fillRect: () => undefined,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
    putImageData: () => undefined,
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
    drawImage: () => undefined,
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    scale: () => undefined,
    translate: () => undefined,
    fillText: () => undefined,
    strokeText: () => undefined,
    measureText: (text: string) => ({
      width: text.length * 8,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
    }),
    getContextAttributes: () => ({ willReadFrequently: true }),
  };
  HTMLCanvasElement.prototype.getContext = function getContext(
    contextId: string,
  ): unknown {
    return contextId === '2d' ? fakeContext : null;
  } as typeof HTMLCanvasElement.prototype.getContext;

  // jsdom implementiert requestAnimationFrame nicht bzw. feuert es nicht
  // zuverlässig — Phasers Game-Loop benötigt ihn auch im HEADLESS-Modus.
  window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    setTimeout(() => callback(performance.now()), 16) as unknown as number;
  window.cancelAnimationFrame = (handle: number): void => clearTimeout(handle);

  // jsdom lädt keine Bilder — Phasers TextureManager wartet beim Boot auf
  // load-Events der Default-Texturen. Stub feuert 'load' sofort.
  class ImmediateImage {
    private listeners = new Map<string, Array<() => void>>();
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 32;
    height = 32;

    addEventListener(type: string, listener: () => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    removeEventListener(): void {
      /* nichts zu tun im Stub */
    }

    set src(_value: string) {
      queueMicrotask(() => {
        this.onload?.();
        for (const listener of this.listeners.get('load') ?? []) listener();
      });
    }
  }
  window.Image = ImmediateImage as unknown as typeof Image;
}

describe('GameEngineService', () => {
  beforeAll(() => {
    stubCanvas2dContext();
  });

  it('maps WASD and arrow keys to bounded movement commands', () => {
    expect(worldDirectionForKey('w')).toBe('N');
    expect(worldDirectionForKey('ArrowRight')).toBe('E');
    expect(worldDirectionForKey('s')).toBe('S');
    expect(worldDirectionForKey('ArrowLeft')).toBe('W');
    expect(worldDirectionForKey('x')).toBeNull();
    expect(worldDirectionForKey('w', true)).toBeNull();
  });

  it('boots Phaser and destroys it cleanly', async () => {
    const [{ GameEngineService }, Phaser] = await Promise.all([
      import('./game-engine.service'),
      import('phaser'),
    ]);

    const engine = new GameEngineService();
    const parent = document.createElement('div');

    // HEADLESS: kein Canvas/WebGL nötig — der Test beweist den technischen
    // Start der Engine; Rendering wird hier nicht geprüft.
    let resolveBoot!: (game: InstanceType<typeof Phaser.Game>) => void;
    const bootedPromise = new Promise<InstanceType<typeof Phaser.Game>>(
      (resolve) => {
        resolveBoot = resolve;
      },
    );
    const game = engine.createGame(
      parent,
      () => resolveBoot(game),
      Phaser.HEADLESS,
    );
    expect(game).toBeInstanceOf(Phaser.Game);

    const bootedGame = await bootedPromise;
    expect(bootedGame).toBe(game);
    expect(game.scene.getScene('boot')).toBeDefined();
    engine.destroyGame(game);
    // Der Shutdown läuft im nächsten Tick des Game-Loops; Phaser 4 setzt
    // isRunning dabei nicht zurück, wohl aber den Loop-Status.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(game.loop.running).toBe(false);
  }, 15_000);
});
