import { Injectable } from '@angular/core';
import Phaser from 'phaser';

/**
 * Minimale Boot-Scene: rein technischer Startnachweis, dass die Engine
 * innerhalb von Angular initialisiert werden kann. Kein Gameplay, keine
 * Sprites, keine Eingaben, keine Kamera-Logik.
 */
class BootScene extends Phaser.Scene {
  constructor(private readonly onBoot: () => void) {
    super('boot');
  }

  create(): void {
    this.onBoot();
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
  ): Phaser.Game {
    return new Phaser.Game({
      type,
      parent,
      width: 800,
      height: 450,
      backgroundColor: '#111827',
      scene: new BootScene(onBoot),
      banner: false,
    });
  }

  destroyGame(game: Phaser.Game): void {
    game.destroy(true);
  }
}
