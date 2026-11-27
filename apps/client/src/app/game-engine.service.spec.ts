import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { WorldEntity } from '@city/game-protocol';
import {
  GameEngineService,
  type WorldRenderer,
  type WorldScenePort,
} from './game-engine.service';
import { movementKeyFor, worldInputFromKeys } from './world-input';

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
    selfAck: () => null,
    sendInput: vi.fn(() => null),
    ...overrides,
  };
}

describe('GameEngineService', () => {
  it('maps WASD and arrow keys to camera-relative world input', () => {
    expect(movementKeyFor('w')).toBe('forward');
    expect(movementKeyFor('ArrowRight')).toBe('right');
    expect(movementKeyFor('s')).toBe('back');
    expect(movementKeyFor('ArrowLeft')).toBe('left');
    expect(movementKeyFor('x')).toBeNull();

    const north = worldInputFromKeys(new Set(['forward']), 0);
    expect(north.x).toBeCloseTo(0);
    expect(north.y).toBeCloseTo(-1);
    // Kamera im Osten (Azimut 90°): vorwärts zeigt nach Westen.
    const west = worldInputFromKeys(new Set(['forward']), Math.PI / 2);
    expect(west.x).toBeCloseTo(-1);
    expect(west.y).toBeCloseTo(0);
    // Diagonal nicht schneller als geradeaus.
    const diagonal = worldInputFromKeys(new Set(['forward', 'right']), 0);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
    expect(worldInputFromKeys(new Set(['forward', 'back']), 0)).toEqual({
      x: 0,
      y: 0,
    });
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
    const parent = document.createElement('div');
    const view = new GameEngineService().createGame(
      parent,
      () => undefined,
      worldPort({ zoneId: () => zoneId }),
      () => renderer,
    );

    expect(view.scene.getObjectByName('building-north-west')).toBeDefined();
    expect(view.scene.getObjectByName('central-fountain')).toBeDefined();
    expect(labelTexts(view.scene)).toContain('Zur Marktgasse');
    view.renderFrame(0);
    expect(parent.textContent).toContain('Zur Marktgasse');

    zoneId = 'market-lane';
    view.renderFrame(16);
    expect(view.scene.getObjectByName('building-north-west')).toBeUndefined();
    expect(view.scene.getObjectByName('stall-north-west')).toBeDefined();
    expect(labelTexts(view.scene)).toEqual(
      expect.arrayContaining(['Zum Platz', 'Marktstand (Job)', 'Straßenessen']),
    );
    expect(labelTexts(view.scene)).not.toContain('Zur Marktgasse');
    // Label-DOM der alten Zone darf nicht über der neuen schweben.
    expect(parent.textContent).not.toContain('Zur Marktgasse');
    expect(parent.textContent).toContain('Zum Platz');

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
    const parent = document.createElement('div');
    const view = new GameEngineService().createGame(
      parent,
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
    expect(parent.textContent).not.toContain('Mara (NPC)');
    view.destroy();
  });

  it('predicts camera-relative keyboard movement and ignores form fields', () => {
    const self = entity({});
    let seq = 0;
    const sendInput = vi.fn<WorldScenePort['sendInput']>(() => (seq += 1));
    const view = new GameEngineService().createGame(
      document.createElement('div'),
      () => undefined,
      worldPort({
        entities: () => [self],
        selfCharacterId: () => self.characterId,
        sendInput,
      }),
      fakeRenderer,
    );
    view.renderFrame(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    for (let frame = 1; frame <= 10; frame += 1) view.renderFrame(frame * 100);
    // Standardkamera blickt nach Norden: „vorwärts“ ist logisch -y.
    const forward = sendInput.mock.calls[0]?.[0];
    expect(forward?.x).toBeCloseTo(0);
    expect(forward?.y).toBeCloseTo(-1);
    expect(sendInput).toHaveBeenCalledTimes(1);
    // Vorhersage ohne Serverbestätigung: 1 s ≈ 6 Einheiten = 3 m nach Norden.
    const avatar = view.scene.getObjectByName(`entity:${self.characterId}`);
    expect(avatar?.position.z).toBeCloseTo(10 - 3, 1);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
    view.renderFrame(1_100);
    expect(sendInput).toHaveBeenLastCalledWith({ x: 0, y: 0 });

    // Fokusverlust stoppt sofort – ohne weiteren Frame (versteckte Tabs rendern nicht).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    view.renderFrame(1_200);
    window.dispatchEvent(new Event('blur'));
    expect(sendInput).toHaveBeenLastCalledWith({ x: 0, y: 0 });
    const callsAfterBlur = sendInput.mock.calls.length;

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'd', bubbles: true }),
    );
    view.renderFrame(1_300);
    expect(sendInput).toHaveBeenCalledTimes(callsAfterBlur);
    input.remove();

    view.destroy();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    expect(sendInput).toHaveBeenCalledTimes(callsAfterBlur);
  });
});
