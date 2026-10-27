import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { WorldEntity } from '@city/game-protocol';
import {
  GameEngineService,
  type WorldRenderer,
  type WorldScenePort,
} from './game-engine.service';
import { worldDirectionForKey } from './world-input';

/**
 * jsdom hat kein WebGL. Der Fake ersetzt nur den Renderer; Szene, Kamera,
 * Labels und Eingaben laufen echt.
 */
function fakeRenderer(): WorldRenderer & {
  loop: ((time: number) => void) | null;
  renders: number;
  disposed: boolean;
} {
  return {
    domElement: document.createElement('canvas'),
    loop: null,
    renders: 0,
    disposed: false,
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    render() {
      this.renders += 1;
    },
    setAnimationLoop(callback) {
      this.loop = callback;
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function entity(overrides: Partial<WorldEntity>): WorldEntity {
  return {
    characterId: '00000000-0000-4000-8000-000000000001',
    kind: 'character',
    name: 'Ada',
    x: 50,
    y: 70,
    energy: 80,
    money: 0,
    interaction: null,
    ...overrides,
  };
}

function labelTexts(scene: THREE.Object3D): string[] {
  const texts: string[] = [];
  scene.traverse((object) => {
    if (object instanceof CSS2DObject) {
      texts.push(object.element.textContent ?? '');
    }
  });
  return texts;
}

function worldPort(overrides: Partial<WorldScenePort> = {}): WorldScenePort {
  return {
    entities: () => [],
    selfCharacterId: () => null,
    zoneId: () => 'central-square',
    move: vi.fn(),
    ...overrides,
  };
}

describe('GameEngineService', () => {
  it('maps WASD and arrow keys to bounded movement commands', () => {
    expect(worldDirectionForKey('w')).toBe('N');
    expect(worldDirectionForKey('ArrowRight')).toBe('E');
    expect(worldDirectionForKey('s')).toBe('S');
    expect(worldDirectionForKey('ArrowLeft')).toBe('W');
    expect(worldDirectionForKey('x')).toBeNull();
    expect(worldDirectionForKey('w', true)).toBeNull();
  });

  it('boots the 3D view after the first frame and destroys it cleanly', () => {
    const renderer = fakeRenderer();
    const parent = document.createElement('div');
    const onBoot = vi.fn();

    const view = new GameEngineService().createGame(
      parent,
      onBoot,
      worldPort(),
      () => renderer,
    );
    expect(parent.contains(renderer.domElement)).toBe(true);
    expect(renderer.loop).not.toBeNull();
    expect(onBoot).not.toHaveBeenCalled();

    renderer.loop?.(0);
    expect(onBoot).toHaveBeenCalledTimes(1);
    expect(renderer.renders).toBe(1);

    new GameEngineService().destroyGame(view);
    expect(renderer.loop).toBeNull();
    expect(renderer.disposed).toBe(true);
    expect(parent.childElementCount).toBe(0);
  });

  it('rebuilds the grey-box when the confirmed zoneId changes', () => {
    let zoneId: 'central-square' | 'market-lane' = 'central-square';
    const renderer = fakeRenderer();
    const view = new GameEngineService().createGame(
      document.createElement('div'),
      () => undefined,
      worldPort({ zoneId: () => zoneId }),
      () => renderer,
    );

    expect(view.scene.getObjectByName('building-north-west')).toBeDefined();
    expect(view.scene.getObjectByName('central-fountain')).toBeDefined();
    expect(labelTexts(view.scene)).toContain('Zur Marktgasse');

    zoneId = 'market-lane';
    view.renderFrame(16);
    expect(view.scene.getObjectByName('building-north-west')).toBeUndefined();
    expect(view.scene.getObjectByName('stall-north-west')).toBeDefined();
    expect(labelTexts(view.scene)).toEqual(
      expect.arrayContaining(['Zum Platz', 'Marktstand (Job)', 'Straßenessen']),
    );
    expect(labelTexts(view.scene)).not.toContain('Zur Marktgasse');

    zoneId = 'central-square';
    view.renderFrame(32);
    expect(view.scene.getObjectByName('stall-north-west')).toBeUndefined();
    expect(labelTexts(view.scene)).toContain('Zur Marktgasse');
    view.destroy();
  });

  it('mirrors confirmed entities and removes them when they leave', () => {
    const self = entity({});
    const npc = entity({
      characterId: '00000000-0000-4000-8000-000000000002',
      kind: 'npc',
      name: 'Mara',
      x: 30,
      y: 30,
    });
    let entities: WorldEntity[] = [self, npc];
    const view = new GameEngineService().createGame(
      document.createElement('div'),
      () => undefined,
      worldPort({
        entities: () => entities,
        selfCharacterId: () => self.characterId,
      }),
      fakeRenderer,
    );

    view.renderFrame(0);
    const selfAvatar = view.scene.getObjectByName(`entity:${self.characterId}`);
    expect(selfAvatar?.position.x).toBeCloseTo(0);
    expect(selfAvatar?.position.z).toBeCloseTo(10);
    expect(labelTexts(view.scene)).toEqual(
      expect.arrayContaining(['Ada', 'Mara (NPC)']),
    );

    entities = [self];
    view.renderFrame(16);
    expect(
      view.scene.getObjectByName(`entity:${npc.characterId}`),
    ).toBeUndefined();
    view.destroy();
  });

  it('sends movement commands from the keyboard but not from form fields', () => {
    const port = worldPort();
    const view = new GameEngineService().createGame(
      document.createElement('div'),
      () => undefined,
      port,
      fakeRenderer,
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    expect(port.move).toHaveBeenCalledWith('N');

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'd', bubbles: true }),
    );
    expect(port.move).toHaveBeenCalledTimes(1);
    input.remove();

    view.destroy();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    expect(port.move).toHaveBeenCalledTimes(1);
  });
});
