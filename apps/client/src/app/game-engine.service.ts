import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { WorldEntity, WorldPoint, WorldZoneId } from '@city/game-protocol';
import {
  EntityLayer,
  buildZoneGreybox,
  disposeObject,
  zoneSkyColor,
} from './world-scene';
import { SelfMovement, type SelfAck } from './self-movement';
import {
  isEditableTarget,
  movementKeyFor,
  worldInputFromKeys,
  type MovementKey,
} from './world-input';

export interface WorldScenePort {
  readonly entities: () => readonly WorldEntity[];
  readonly selfCharacterId: () => string | null;
  readonly zoneId: () => WorldZoneId | null;
  /** Letzte Server-Bestätigung der eigenen Position (Prediction-Abgleich). */
  readonly selfAck: () => SelfAck | null;
  /** Sendet eine Bewegungsabsicht; liefert die Sequenz oder `null`. */
  sendInput(input: WorldPoint): number | null;
}

/** Schmale Renderer-Schnittstelle; Tests ersetzen WebGL durch einen Fake. */
export interface WorldRenderer {
  readonly domElement: HTMLCanvasElement;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  setAnimationLoop(callback: ((time: number) => void) | null): void;
  dispose(): void;
}

export type WorldRendererFactory = () => WorldRenderer;

function createWebGlRenderer(): WorldRenderer {
  return new THREE.WebGLRenderer({ antialias: true });
}

const FALLBACK_SIZE = { width: 800, height: 450 } as const;
const CAMERA_OFFSET = new THREE.Vector3(0, 18, 18);
const CAMERA_LOOK_HEIGHT = 1;

/**
 * 3D-Weltansicht: rendert die bestätigte Zone als Grey-Box, sagt die eigene
 * Figur mit der gemeinsamen Bewegungsfunktion voraus und interpoliert alle
 * anderen Entities. Autorität über Positionen bleibt beim Server.
 */
export class WorldView {
  readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
  private readonly renderer: WorldRenderer;
  private readonly labelRenderer = new CSS2DRenderer();
  private readonly controls: OrbitControls;
  private readonly entities = new EntityLayer();
  private readonly resizeObserver: ResizeObserver | null;
  private readonly desiredTarget = new THREE.Vector3();
  private readonly pressedKeys = new Set<MovementKey>();
  private readonly selfMovement: SelfMovement;
  private lastAck: SelfAck | null = null;
  private zoneGroup: THREE.Group | null = null;
  private zoneId: WorldZoneId | null = null;
  private lastFrameTime: number | null = null;
  private booted = false;

  constructor(
    private readonly parent: HTMLElement,
    private readonly onBoot: () => void,
    private readonly world: WorldScenePort | undefined,
    createRenderer: WorldRendererFactory,
  ) {
    this.selfMovement = new SelfMovement(
      (input) => this.world?.sendInput(input) ?? null,
    );
    this.renderer = createRenderer();
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    this.renderer.domElement.style.display = 'block';
    parent.appendChild(this.renderer.domElement);

    const labels = this.labelRenderer.domElement;
    labels.style.position = 'absolute';
    labels.style.inset = '0';
    labels.style.pointerEvents = 'none';
    labels.style.zIndex = '1';
    parent.appendChild(labels);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4b5a43, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(20, 35, 15);
    this.scene.add(sun);
    this.scene.add(this.entities.root);

    this.camera.position.copy(CAMERA_OFFSET);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 45;
    // Nicht senkrecht von oben und nie unter den Boden kippen.
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.2;
    this.controls.target.set(0, CAMERA_LOOK_HEIGHT, 0);
    this.controls.update();

    this.showZone(world?.zoneId() ?? null);
    this.resize();
    this.resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(parent);
    globalThis.addEventListener('keydown', this.handleKeydown);
    globalThis.addEventListener('keyup', this.handleKeyup);
    globalThis.addEventListener('blur', this.handleBlur);
    this.renderer.setAnimationLoop(this.renderFrame);
  }

  /** Ein Frame: Zone/Entities aus bestätigtem State ableiten und zeichnen. */
  readonly renderFrame = (time: number): void => {
    const deltaSeconds =
      this.lastFrameTime === null
        ? 0
        : Math.min((time - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = time;

    const zoneChanged = this.syncZone();
    const selfId = this.world?.selfCharacterId() ?? null;
    if (this.world) {
      const entities = this.world.entities();
      this.entities.sync(entities, selfId, zoneChanged, time);
      this.updateSelfMovement(
        entities.find((entity) => entity.characterId === selfId) ?? null,
        zoneChanged,
        deltaSeconds,
        time,
      );
    }
    this.entities.update(time, selfId, this.selfMovement.position);
    this.followSelf(zoneChanged);
    this.controls.update();

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);

    if (!this.booted) {
      this.booted = true;
      this.onBoot();
    }
  };

  destroy(): void {
    this.renderer.setAnimationLoop(null);
    globalThis.removeEventListener('keydown', this.handleKeydown);
    globalThis.removeEventListener('keyup', this.handleKeyup);
    globalThis.removeEventListener('blur', this.handleBlur);
    this.resizeObserver?.disconnect();
    this.controls.dispose();
    if (this.zoneGroup) {
      this.scene.remove(this.zoneGroup);
      disposeObject(this.zoneGroup);
    }
    this.entities.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }

  /** Baut die Zone neu, sobald der bestätigte `zoneId` wechselt. */
  private syncZone(): boolean {
    const zoneId = this.world?.zoneId() ?? null;
    if (zoneId === null || zoneId === this.zoneId) return false;
    this.showZone(zoneId);
    return true;
  }

  private showZone(zoneId: WorldZoneId | null): void {
    if (this.zoneGroup) {
      this.scene.remove(this.zoneGroup);
      disposeObject(this.zoneGroup);
      this.zoneGroup = null;
    }
    this.zoneId = zoneId;
    if (zoneId === null) return;

    this.zoneGroup = buildZoneGreybox(zoneId);
    this.scene.add(this.zoneGroup);
    this.scene.background = new THREE.Color(zoneSkyColor(zoneId));
  }

  /** Prediction der eigenen Figur: Input senden, simulieren, abgleichen. */
  private updateSelfMovement(
    self: WorldEntity | null,
    zoneChanged: boolean,
    deltaSeconds: number,
    time: number,
  ): void {
    if (!self || !this.zoneId) {
      this.selfMovement.clear();
      return;
    }
    if (zoneChanged || !this.selfMovement.position) {
      this.selfMovement.reset(self, this.zoneId);
    }

    const input =
      this.pressedKeys.size > 0
        ? worldInputFromKeys(
            this.pressedKeys,
            this.controls.getAzimuthalAngle(),
          )
        : { x: 0, y: 0 };
    this.selfMovement.setInput(input, time);

    const ack = this.world?.selfAck() ?? null;
    if (ack && ack !== this.lastAck) {
      this.lastAck = ack;
      this.selfMovement.reconcile(ack);
    }
    this.selfMovement.advance(deltaSeconds);
  }

  /** Kamera folgt der eigenen Figur, Drehung und Zoom bleiben erhalten. */
  private followSelf(snap: boolean): void {
    const selfId = this.world?.selfCharacterId() ?? null;
    const position = selfId ? this.entities.positionOf(selfId) : null;
    if (!position) return;

    this.desiredTarget.set(position.x, CAMERA_LOOK_HEIGHT, position.z);
    const delta = this.desiredTarget.sub(this.controls.target);
    if (!snap) delta.multiplyScalar(0.2);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
  }

  private resize(): void {
    const width = this.parent.clientWidth || FALLBACK_SIZE.width;
    const height = this.parent.clientHeight || FALLBACK_SIZE.height;
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (
      isEditableTarget(
        event.target,
        typeof document !== 'undefined' ? document.activeElement : null,
      )
    ) {
      return;
    }

    const key = movementKeyFor(event.key);
    if (!key || !this.world) return;

    event.preventDefault();
    this.pressedKeys.add(key);
  };

  private readonly handleKeyup = (event: KeyboardEvent): void => {
    const key = movementKeyFor(event.key);
    if (key) this.pressedKeys.delete(key);
  };

  /** Fokusverlust lässt keine „klebende“ Taste zurück. */
  private readonly handleBlur = (): void => {
    this.pressedKeys.clear();
  };
}

/**
 * Adapter zwischen Angular und Three.js. Kapselt Erstellung und Zerstörung
 * der Weltansicht, damit Komponenten keine Engine-Details kennen müssen.
 */
@Injectable({ providedIn: 'root' })
export class GameEngineService {
  createGame(
    parent: HTMLElement,
    onBoot: () => void,
    world?: WorldScenePort,
    createRenderer: WorldRendererFactory = createWebGlRenderer,
  ): WorldView {
    return new WorldView(parent, onBoot, world, createRenderer);
  }

  destroyGame(view: WorldView): void {
    view.destroy();
  }
}
