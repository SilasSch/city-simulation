import { Injectable } from '@angular/core';
import Phaser from 'phaser';
import {
  WORLD_COORDINATE_MAX,
  WORLD_COORDINATE_MIN,
} from '@city/game-protocol';
import type { WorldDirection, WorldEntity } from '@city/game-protocol';
import {
  CENTRAL_SQUARE_BOUNDS,
  CENTRAL_SQUARE_ENTITY_INSET,
  CENTRAL_SQUARE_VIEWPORT,
  renderCentralSquare,
} from './central-square-map';
import { worldDirectionForKey } from './world-input';

export interface WorldScenePort {
  readonly entities: () => readonly WorldEntity[];
  readonly selfCharacterId: () => string | null;
  move(direction: WorldDirection): void;
}

interface EntityMarker {
  readonly dot: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
}

/**
 * Kleinste Welt-Scene: zeichnet eine Zone und spiegelt Marker direkt aus dem
 * bestätigten World-State. Eingaben senden nur Commands; die Scene bewegt
 * selbst keine Entity.
 */
class WorldScene extends Phaser.Scene {
  private readonly markers = new Map<string, EntityMarker>();

  constructor(
    private readonly onBoot: () => void,
    private readonly world?: WorldScenePort,
  ) {
    super('boot');
  }

  create(): void {
    renderCentralSquare(this);

    this.input.keyboard?.on('keydown', this.handleKeydown);
    this.onBoot();
  }

  override update(): void {
    this.syncMarkers();
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
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
      marker.dot.destroy();
      marker.label.destroy();
      this.markers.delete(characterId);
    }

    for (const entity of entities) {
      const marker =
        this.markers.get(entity.characterId) ?? this.createMarker(entity);
      const position = this.toScreenPosition(entity);
      const isSelf = entity.characterId === this.world.selfCharacterId();

      marker.dot.clear();
      marker.dot.fillStyle(isSelf ? 0x38bdf8 : 0xa78bfa, 1);
      marker.dot.fillCircle(position.x, position.y, isSelf ? 8 : 6);
      if (entity.interaction) {
        marker.dot.lineStyle(2, 0xfacc15, 0.95);
        marker.dot.strokeCircle(position.x, position.y, 13);
      }
      marker.label.setPosition(position.x + 10, position.y - 8);
    }
  }

  private createMarker(entity: WorldEntity): EntityMarker {
    const marker = {
      dot: this.add.graphics().setDepth(10),
      label: this.add
        .text(0, 0, entity.name, {
          color: '#e5e7eb',
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
    const usableWidth =
      CENTRAL_SQUARE_BOUNDS.width - CENTRAL_SQUARE_ENTITY_INSET * 2;
    const usableHeight =
      CENTRAL_SQUARE_BOUNDS.height - CENTRAL_SQUARE_ENTITY_INSET * 2;

    return {
      x:
        CENTRAL_SQUARE_BOUNDS.x +
        CENTRAL_SQUARE_ENTITY_INSET +
        ((entity.x - WORLD_COORDINATE_MIN) / coordinateRange) * usableWidth,
      y:
        CENTRAL_SQUARE_BOUNDS.y +
        CENTRAL_SQUARE_ENTITY_INSET +
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
      width: CENTRAL_SQUARE_VIEWPORT.width,
      height: CENTRAL_SQUARE_VIEWPORT.height,
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
