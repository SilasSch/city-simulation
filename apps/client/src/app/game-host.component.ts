import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import Phaser from 'phaser';
import { GameEngineService } from './game-engine.service';

/**
 * Einzige Komponente mit Phaser-Bezug. Startet die Engine außerhalb der
 * Angular-Zone (kein unnötiges Change-Detection-Ticken) und zerstört sie
 * kontrolliert. Enthält keine Spielogik.
 */
@Component({
  selector: 'app-game-host',
  template: `
    <section class="game-host">
      <h2>Engine</h2>
      <p data-testid="engine-status">
        Phaser-Status: {{ engineBooted() ? 'gestartet' : 'startet…' }}
      </p>
      <div #gameContainer class="game-container"></div>
    </section>
  `,
})
export class GameHostComponent implements AfterViewInit, OnDestroy {
  @ViewChild('gameContainer', { static: true })
  private readonly gameContainer!: ElementRef<HTMLDivElement>;

  protected readonly engineBooted = signal(false);

  private readonly engine = inject(GameEngineService);
  private readonly zone = inject(NgZone);
  private game: Phaser.Game | null = null;

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.game = this.engine.createGame(
        this.gameContainer.nativeElement,
        () => {
          this.engineBooted.set(true);
        },
      );
    });
  }

  ngOnDestroy(): void {
    if (this.game) {
      this.engine.destroyGame(this.game);
      this.game = null;
    }
  }
}
