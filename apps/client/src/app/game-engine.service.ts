import { Injectable } from '@angular/core';
import Phaser from 'phaser';
import {
  MARKET_LANE_ZONE_ID,
  WORLD_COORDINATE_MAX,
  WORLD_COORDINATE_MIN,
  WORLD_ZONE_ID,
} from '@city/game-protocol';
import type {
  WorldDirection,
  WorldEntity,
  WorldZoneId,
} from '@city/game-protocol';
import { renderCentralSquare } from './central-square-map';
import { ensureCentralSquareTextures } from './central-square-textures';
import { renderMarketLane } from './market-lane-map';
import { ensureMarketLaneTextures } from './market-lane-textures';
import {
  WORLD_MAP_BOUNDS,
  WORLD_MAP_ENTITY_INSET,
  WORLD_VIEWPORT,
  type ZoneMapHandle,
} from './world-map-layout';
import { isEditableTarget, worldDirectionForKey } from './world-input';

export interface WorldScenePort {
  readonly entities: () => readonly WorldEntity[];
  readonly selfCharacterId: () => string | null;
  readonly zoneId: () => WorldZoneId | null;
  move(direction: WorldDirection): void;
}

interface EntityMarker {
  readonly sprite: Phaser.GameObjects.Image | null;
  readonly dot: Phaser.GameObjects.Graphics;
  readonly ring: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
}

/**
 * Kleinste Welt-Scene: zeichnet eine Zone und spiegelt Marker direkt aus dem
 * bestätigten World-State. Eingaben senden nur Commands; die Scene bewegt
 * selbst keine Entity.
 */
class WorldScene extends Phaser.Scene {
  private readonly markers = new Map<string, EntityMarker>();
  private zoneBanner: Phaser.GameObjects.Text | null = null;
  private mapHandle: ZoneMapHandle | null = null;
  private renderedZoneId: WorldZoneId | null = null;

  constructor(
    private readonly onBoot: () => void,
    private readonly world?: WorldScenePort,
  ) {
    super('boot');
  }

  create(): void {
    ensureCentralSquareTextures(this);
    ensureMarketLaneTextures(this);
    this.mapHandle = renderCentralSquare(this);
    this.renderedZoneId = WORLD_ZONE_ID;
    this.zoneBanner = this.add
      .text(12, WORLD_VIEWPORT.height - 28, 'Zone: Zentraler Platz', {
        color: '#e2e8f0',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        backgroundColor: '#0f172a99',
        padding: { x: 8, y: 4 },
      })
      .setDepth(20)
      .setScrollFactor(0);

    // Full 16:9 stage shows the whole square — no zoom crop / chase-cam.
    this.cameras.main.setBounds(
      0,
      0,
      WORLD_VIEWPORT.width,
      WORLD_VIEWPORT.height,
    );
    this.cameras.main.setZoom(1);
    this.cameras.main.centerOn(
      WORLD_VIEWPORT.width / 2,
      WORLD_VIEWPORT.height / 2,
    );
    this.cameras.main.setRoundPixels(true);
    this.cameras.main.setBackgroundColor('#16251c');

    this.input.keyboard?.on('keydown', this.handleKeydown);
    this.onBoot();
  }

  override update(): void {
    this.syncZoneMap();
    this.syncMarkers();
  }

  /**
   * Snapshot-driven zone art: tear down the previous map layer and rebuild
   * when confirmed zoneId changes. No optimistic swap.
   */
  private syncZoneMap(): void {
    if (!this.world || !this.zoneBanner) return;
    const zoneId = this.world.zoneId();
    if (zoneId === null || zoneId === this.renderedZoneId) return;

    this.mapHandle?.destroy();
    this.renderedZoneId = zoneId;

    if (zoneId === MARKET_LANE_ZONE_ID) {
      ensureMarketLaneTextures(this);
      this.mapHandle = renderMarketLane(this);
      this.zoneBanner.setText('Zone: Marktgasse');
      this.cameras.main.setBackgroundColor('#2a1f14');
    } else {
      ensureCentralSquareTextures(this);
      this.mapHandle = renderCentralSquare(this);
      this.zoneBanner.setText('Zone: Zentraler Platz');
      this.cameras.main.setBackgroundColor('#16251c');
    }

    // Banner stays above rebuilt map art.
    this.zoneBanner.setDepth(20);
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

    const direction = worldDirectionForKey(event.key, event.repeat);
    if (!direction || !this.world) return;

    event.preventDefault();
    this.world.move(direction);
  };

  private syncMarkers(): void {
    if (!this.world) return;

    const entities = this.world.entities();
    const currentIds = new Set(entities.map((entity) => entity.characterId));

    for (const [characterId, marker] of this.markers) {
      if (currentIds.has(characterId)) continue;
      marker.sprite?.destroy();
      marker.dot.destroy();
      marker.ring.destroy();
      marker.label.destroy();
      this.markers.delete(characterId);
    }

    for (const entity of entities) {
      const marker =
        this.markers.get(entity.characterId) ?? this.createMarker(entity);
      const position = this.toScreenPosition(entity);
      const isSelf = entity.characterId === this.world.selfCharacterId();
      const isNpc = entity.kind === 'npc';
      const textureKey = isNpc
        ? 'cs-character-npc'
        : isSelf
          ? 'cs-character-self'
          : 'cs-character-other';

      if (marker.sprite) {
        marker.sprite.setTexture(textureKey);
        marker.sprite.setPosition(position.x, position.y);
        marker.dot.clear();
      } else {
        marker.dot.clear();
        marker.dot.fillStyle(
          isNpc ? 0xf59e0b : isSelf ? 0x38bdf8 : 0xa78bfa,
          1,
        );
        marker.dot.fillCircle(position.x, position.y, isSelf && !isNpc ? 8 : 6);
      }
      marker.ring.clear();
      if (entity.interaction) {
        marker.ring.lineStyle(2, 0xfacc15, 0.95);
        marker.ring.strokeCircle(position.x, position.y, 16);
      }
      marker.label.setText(isNpc ? `${entity.name} (NPC)` : entity.name);
      marker.label.setPosition(position.x + 12, position.y - 18);
    }
  }

  private createMarker(entity: WorldEntity): EntityMarker {
    const isSelf = entity.characterId === this.world?.selfCharacterId();
    const isNpc = entity.kind === 'npc';
    const canSprite =
      this.textures.exists('cs-character-self') &&
      this.textures.exists('cs-character-other') &&
      this.textures.exists('cs-character-npc');
    const textureKey = isNpc
      ? 'cs-character-npc'
      : isSelf
        ? 'cs-character-self'
        : 'cs-character-other';
    const marker = {
      sprite: canSprite
        ? this.add.image(0, 0, textureKey).setDepth(10).setOrigin(0.5, 0.85)
        : null,
      dot: this.add.graphics().setDepth(10),
      ring: this.add.graphics().setDepth(9),
      label: this.add
        .text(0, 0, isNpc ? `${entity.name} (NPC)` : entity.name, {
          color: isNpc ? '#fde68a' : '#f8fafc',
          fontFamily: 'system-ui, sans-serif',
          fontSize: '12px',
          stroke: '#172019',
          strokeThickness: 3,
        })
        .setDepth(11),
    };
    this.markers.set(entity.characterId, marker);
    return marker;
  }

  private toScreenPosition(entity: WorldEntity): { x: number; y: number } {
    const coordinateRange = WORLD_COORDINATE_MAX - WORLD_COORDINATE_MIN;
    const usableWidth = WORLD_MAP_BOUNDS.width - WORLD_MAP_ENTITY_INSET * 2;
    const usableHeight = WORLD_MAP_BOUNDS.height - WORLD_MAP_ENTITY_INSET * 2;

    return {
      x:
        WORLD_MAP_BOUNDS.x +
        WORLD_MAP_ENTITY_INSET +
        ((entity.x - WORLD_COORDINATE_MIN) / coordinateRange) * usableWidth,
      y:
        WORLD_MAP_BOUNDS.y +
        WORLD_MAP_ENTITY_INSET +
        ((entity.y - WORLD_COORDINATE_MIN) / coordinateRange) * usableHeight,
    };
  }
}

/**
 * Adapter zwischen Angular und Phaser. Kapselt Erstellung und Zerstörung
 * des Phaser.Game, damit Komponenten keine Engine-Details kennen müssen.
 */
@Injectable({ providedIn: 'root' })
export class GameEngineService {
  createGame(
    parent: HTMLElement,
    onBoot: () => void,
    type: number = Phaser.AUTO,
    world?: WorldScenePort,
  ): Phaser.Game {
    return new Phaser.Game({
      type,
      parent,
      width: WORLD_VIEWPORT.width,
      height: WORLD_VIEWPORT.height,
      backgroundColor: '#16251c',
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: new WorldScene(onBoot, world),
      banner: false,
    });
  }

  destroyGame(game: Phaser.Game): void {
    game.destroy(true);
  }
}
