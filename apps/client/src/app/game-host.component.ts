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
import type {
  WorldEntity,
  WorldInteractionObjectId,
} from '@city/game-protocol';
import { worldInteractionObject } from '@city/game-protocol';
import { GameEngineService } from './game-engine.service';
import { RealtimeService } from './realtime.service';
import { WorldStateService } from './world-state.service';

/**
 * Einzige Komponente mit Phaser-Bezug. Startet die Engine außerhalb der
 * Angular-Zone (kein unnötiges Change-Detection-Ticken) und zerstört sie
 * kontrolliert. Enthält keine Spielogik.
 */
@Component({
  selector: 'app-game-host',
  styles: [
    `
      .game-host {
        display: grid;
        gap: 0.75rem;
      }
      .hud {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem 1rem;
        align-items: center;
        padding: 0.65rem 0.85rem;
        border-radius: 0.5rem;
        background: #111827;
        border: 1px solid #274056;
      }
      .hud-stat {
        display: grid;
        gap: 0.2rem;
        min-width: 7rem;
      }
      .hud-stat strong {
        font-size: 0.95rem;
        color: #f8fafc;
      }
      .hud-label {
        font-size: 0.7rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .energy-bar {
        width: 8rem;
        height: 0.45rem;
        border-radius: 999px;
        background: #1e293b;
        overflow: hidden;
      }
      .energy-bar > span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #22c55e, #86efac);
      }
      .hud-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-left: auto;
      }
      .hud-actions button {
        background: #1f2937;
        border: 1px solid #475569;
        border-radius: 0.35rem;
        color: #e5e7eb;
        padding: 0.35rem 0.7rem;
        cursor: pointer;
        font-size: 0.85rem;
      }
      .hud-actions button:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .interaction-chip {
        width: 100%;
        margin: 0;
        padding: 0.35rem 0.6rem;
        border-radius: 0.35rem;
        background: #422006;
        color: #fde68a;
        font-size: 0.85rem;
      }
      .meta {
        margin: 0;
        color: #64748b;
        font-size: 0.8rem;
      }
      .game-container {
        width: min(100%, 800px);
        aspect-ratio: 16 / 9;
        border-radius: 0.5rem;
        overflow: hidden;
        border: 1px solid #1f2937;
        background: #16251c;
      }
    `,
  ],
  template: `
    <section class="game-host">
      <h2>Central Square</h2>

      @if (world.selfEntity(); as self) {
        <div class="hud" role="status">
          <div class="hud-stat">
            <span class="hud-label">Geld</span>
            <strong data-testid="money">{{ self.money }}</strong>
          </div>
          <div class="hud-stat">
            <span class="hud-label">Energy</span>
            <strong data-testid="energy"
              >{{ self.energy.toFixed(0) }} / 100</strong
            >
            <div class="energy-bar" aria-hidden="true">
              <span [style.width.%]="energyPercent(self)"></span>
            </div>
          </div>
          <div class="hud-actions">
            <button
              type="button"
              data-testid="rest-action"
              [disabled]="!!self.interaction || !inRange(self, 'bench-south')"
              (click)="world.interact('bench-south')"
            >
              Ausruhen
            </button>
            <button
              type="button"
              data-testid="job-action"
              [disabled]="!!self.interaction || !inRange(self, 'kiosk-north')"
              (click)="world.interact('kiosk-north')"
            >
              Job (+{{ jobMoneyGain }})
            </button>
            <button
              type="button"
              data-testid="shop-action"
              [disabled]="
                !!self.interaction ||
                self.money < snackPrice ||
                !inRange(self, 'snack-east')
              "
              (click)="world.interact('snack-east')"
            >
              Snack (−{{ snackPrice }})
            </button>
          </div>
          @if (self.interaction; as interaction) {
            <p class="interaction-chip" data-testid="interaction-state">
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
        </div>
      } @else if (realtime.connectionState() === 'connected') {
        <p class="meta" data-testid="world-loading">Spielwelt wird geladen…</p>
      }

      <div #gameContainer class="game-container"></div>

      <p class="meta">WASD / Pfeiltasten · Aktionen nur in Reichweite</p>
      <p class="meta" data-testid="engine-status">
        Phaser: {{ engineBooted() ? 'bereit' : 'startet…' }}
      </p>
      <p class="meta" data-testid="world-zone">
        Zone: {{ world.zoneId() ?? '—' }}
      </p>
      <p class="meta" data-testid="world-player-count">
        Sichtbar: {{ world.entities().length }}
      </p>
      <p class="meta" data-testid="simulation-time">
        Zeit: {{ simulationTimeText() }}
      </p>
    </section>
  `,
})
export class GameHostComponent implements AfterViewInit, OnDestroy {
  @ViewChild('gameContainer', { static: true })
  private readonly gameContainer!: ElementRef<HTMLDivElement>;

  protected readonly engineBooted = signal(false);
  protected readonly snackPrice = worldInteractionObject('snack-east').price;
  protected readonly snackEnergyGain =
    worldInteractionObject('snack-east').energyGain;
  protected readonly jobMoneyGain =
    worldInteractionObject('kiosk-north').moneyGain;

  private readonly engine = inject(GameEngineService);
  protected readonly realtime = inject(RealtimeService);
  protected readonly world = inject(WorldStateService);
  private readonly zone = inject(NgZone);
  private game: Phaser.Game | null = null;

  protected energyPercent(self: WorldEntity): number {
    return Math.max(0, Math.min(100, self.energy));
  }

  protected inRange(
    self: WorldEntity,
    objectId: WorldInteractionObjectId,
  ): boolean {
    const object = worldInteractionObject(objectId);
    const dx = self.x - object.x;
    const dy = self.y - object.y;
    return Math.hypot(dx, dy) <= object.interactionRange;
  }

  protected simulationTimeText(): string {
    const value = this.world.simulatedTime();
    if (!value) return 'sync…';
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
