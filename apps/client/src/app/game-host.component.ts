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
import { RealtimeService } from './realtime.service';
import { worldInteractionObject } from '@city/game-protocol';
import { WorldStateService } from './world-state.service';

/**
 * Einzige Komponente mit Phaser-Bezug. Startet die Engine außerhalb der
 * Angular-Zone (kein unnötiges Change-Detection-Ticken) und zerstört sie
 * kontrolliert. Enthält keine Spielogik.
 */
@Component({
  selector: 'app-game-host',
  template: `
    <section class="game-host">
      <h2>Welt</h2>
      <p data-testid="engine-status">
        Phaser-Status: {{ engineBooted() ? 'gestartet' : 'startet…' }}
      </p>
      <p data-testid="world-zone">
        Zone: {{ world.zoneId() ?? 'noch nicht betreten' }}
      </p>
      @if (realtime.connectionState() === 'connected' && !world.zoneId()) {
        <p data-testid="world-loading">Spielwelt wird geladen…</p>
      }
      <p data-testid="world-player-count">
        Sichtbare Characters: {{ world.entities().length }}
      </p>
      <p data-testid="simulation-time">
        Simulationszeit: {{ simulationTimeText() }}
      </p>
      @if (world.selfEntity(); as self) {
        <p data-testid="energy">Energy: {{ self.energy.toFixed(1) }} / 100</p>
        <p data-testid="money">Geld: {{ self.money }}</p>
        @if (self.interaction; as interaction) {
          <p data-testid="interaction-state">
            @if (interaction.objectId === 'bench-south') {
              Ruht auf der Bank:
            } @else if (interaction.objectId === 'kiosk-north') {
              Arbeitet am Kiosk:
            } @else {
              Interaktion:
            }
            {{ (interaction.progress * 100).toFixed(0) }} %
          </p>
        }
        <button
          type="button"
          data-testid="rest-action"
          [disabled]="!!self.interaction"
          (click)="world.interact('bench-south')"
        >
          Auf der südlichen Bank ausruhen
        </button>
        <button
          type="button"
          data-testid="job-action"
          [disabled]="!!self.interaction"
          (click)="world.interact('kiosk-north')"
        >
          Am Nord-Kiosk arbeiten (+25 Geld)
        </button>
        <button
          type="button"
          data-testid="shop-action"
          [disabled]="!!self.interaction || self.money < snackPrice"
          (click)="world.interact('snack-east')"
        >
          Snack kaufen (−{{ snackPrice }} Geld, +{{ snackEnergyGain }} Energy)
        </button>
      }
      <p>Steuerung: WASD oder Pfeiltasten</p>
      <div #gameContainer class="game-container"></div>
    </section>
  `,
})
export class GameHostComponent implements AfterViewInit, OnDestroy {
  @ViewChild('gameContainer', { static: true })
  private readonly gameContainer!: ElementRef<HTMLDivElement>;

  protected readonly engineBooted = signal(false);

  private readonly engine = inject(GameEngineService);
  protected readonly realtime = inject(RealtimeService);
  protected readonly world = inject(WorldStateService);
  private readonly zone = inject(NgZone);
  private game: Phaser.Game | null = null;

  protected simulationTimeText(): string {
    const value = this.world.simulatedTime();
    if (!value) return 'wird synchronisiert…';
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(value));
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.game = this.engine.createGame(
        this.gameContainer.nativeElement,
        () => {
          this.engineBooted.set(true);
        },
        Phaser.AUTO,
        this.world,
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
