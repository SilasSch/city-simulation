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
  WorldZonePortal,
} from '@city/game-protocol';
import {
  MARKET_LANE_ZONE_ID,
  NPC_INTERACTION_RANGE,
  WORLD_ZONE_ID,
  worldInteractionObject,
  worldZonePortalsIn,
} from '@city/game-protocol';
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
      :host {
        display: block;
      }
      .game-host {
        /* Escape the narrow <main> column — true landscape stage. */
        width: 100vw;
        margin-left: calc(50% - 50vw);
        margin-right: calc(50% - 50vw);
        display: grid;
        gap: 0.75rem;
        justify-items: center;
      }
      .stage {
        position: relative;
        width: min(100vw, calc(100vh * 16 / 9));
        height: min(100vh, calc(100vw * 9 / 16));
        max-height: 100vh;
        border-radius: 0.5rem;
        overflow: hidden;
        border: 1px solid #1f2937;
        background: #16251c;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      }
      .hud {
        position: absolute;
        z-index: 2;
        top: 0.75rem;
        left: 0.75rem;
        right: 0.75rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem 1rem;
        align-items: center;
        padding: 0.65rem 0.85rem;
        border-radius: 0.5rem;
        background: rgba(17, 24, 39, 0.88);
        border: 1px solid #274056;
        backdrop-filter: blur(6px);
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
      .npc-toast {
        width: 100%;
        margin: 0;
        padding: 0.4rem 0.65rem;
        border-radius: 0.35rem;
        background: #1e3a5f;
        color: #dbeafe;
        font-size: 0.85rem;
        border: 1px solid #3b82f6;
      }
      .npc-toast strong {
        color: #fde68a;
      }
      .game-container {
        width: 100%;
        height: 100%;
      }
      .meta {
        margin: 0;
        color: #64748b;
        font-size: 0.8rem;
      }
      .meta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem 1.25rem;
        justify-content: center;
        max-width: min(100vw, calc(100vh * 16 / 9));
      }
    `,
  ],
  template: `
    <section class="game-host">
      <div class="stage">
        @if (world.selfEntity(); as self) {
          <div class="hud">
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
              @if (world.zoneId() === centralSquareZoneId) {
                <button
                  type="button"
                  data-testid="rest-action"
                  [disabled]="
                    !!self.interaction || !inRange(self, 'bench-south')
                  "
                  (click)="world.interact('bench-south')"
                >
                  Ausruhen
                </button>
                <button
                  type="button"
                  data-testid="job-action"
                  [disabled]="
                    !!self.interaction || !inRange(self, 'kiosk-north')
                  "
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
                <button
                  type="button"
                  data-testid="npc-talk-action"
                  [disabled]="!!self.interaction || !npcInRange(self)"
                  (click)="talkToNearbyNpc(self)"
                >
                  Sprechen
                </button>
              }
              @if (world.zoneId() === marketLaneZoneId) {
                <button
                  type="button"
                  data-testid="stall-job-action"
                  [disabled]="
                    !!self.interaction || !inRange(self, 'stall-north')
                  "
                  (click)="world.interact('stall-north')"
                >
                  Am Stall helfen (+{{ stallMoneyGain }})
                </button>
                <button
                  type="button"
                  data-testid="market-shop-action"
                  [disabled]="
                    !!self.interaction ||
                    self.money < streetFoodPrice ||
                    !inRange(self, 'street-food-east')
                  "
                  (click)="world.interact('street-food-east')"
                >
                  Straßenessen (−{{ streetFoodPrice }})
                </button>
              }
              @if (nearbyPortal(self); as portal) {
                <button
                  type="button"
                  data-testid="portal-action"
                  [disabled]="!!self.interaction"
                  (click)="world.transition(portal.id)"
                >
                  {{ portal.label }}
                </button>
              }
            </div>
            @if (self.interaction; as interaction) {
              <p class="interaction-chip" data-testid="interaction-state">
                @if (interaction.objectId === 'bench-south') {
                  Ruht auf der Bank:
                } @else if (interaction.objectId === 'kiosk-north') {
                  Arbeitet am Kiosk:
                } @else if (interaction.objectId === 'stall-north') {
                  Hilft am Stall:
                } @else {
                  Interaktion:
                }
                {{ (interaction.progress * 100).toFixed(0) }} %
              </p>
            }
            @if (world.interactFeedback(); as feedback) {
              <p class="npc-toast" data-testid="npc-interact-feedback">
                <strong>{{ feedback.npcName }}:</strong>
                {{ feedback.message }}
              </p>
            }
          </div>
        } @else if (realtime.connectionState() === 'connected') {
          <p class="meta" data-testid="world-loading" style="padding: 1rem">
            Spielwelt wird geladen…
          </p>
        }

        <div #gameContainer class="game-container"></div>
      </div>

      <div class="meta-row">
        <p class="meta">WASD / Pfeiltasten · 16:9 Vollbreite</p>
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
      </div>
    </section>
  `,
})
export class GameHostComponent implements AfterViewInit, OnDestroy {
  @ViewChild('gameContainer', { static: true })
  private readonly gameContainer!: ElementRef<HTMLDivElement>;

  protected readonly engineBooted = signal(false);
  protected readonly snackPrice = worldInteractionObject('snack-east').price;
  protected readonly streetFoodPrice =
    worldInteractionObject('street-food-east').price;
  protected readonly jobMoneyGain =
    worldInteractionObject('kiosk-north').moneyGain;
  protected readonly stallMoneyGain =
    worldInteractionObject('stall-north').moneyGain;
  protected readonly centralSquareZoneId = WORLD_ZONE_ID;
  protected readonly marketLaneZoneId = MARKET_LANE_ZONE_ID;

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
    if (this.world.zoneId() !== object.zoneId) return false;
    const dx = self.x - object.x;
    const dy = self.y - object.y;
    return Math.hypot(dx, dy) <= object.interactionRange;
  }

  protected nearbyNpc(self: WorldEntity): WorldEntity | null {
    let best: WorldEntity | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const entity of this.world.entities()) {
      if (entity.kind !== 'npc') continue;
      const distance = Math.hypot(self.x - entity.x, self.y - entity.y);
      if (distance <= NPC_INTERACTION_RANGE && distance < bestDistance) {
        best = entity;
        bestDistance = distance;
      }
    }
    return best;
  }

  protected npcInRange(self: WorldEntity): boolean {
    return this.nearbyNpc(self) !== null;
  }

  protected talkToNearbyNpc(self: WorldEntity): void {
    const npc = this.nearbyNpc(self);
    if (!npc) return;
    this.world.interactNpc(npc.characterId);
  }

  protected nearbyPortal(self: WorldEntity): WorldZonePortal | null {
    const zoneId = this.world.zoneId();
    if (!zoneId) return null;
    let best: WorldZonePortal | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const portal of worldZonePortalsIn(zoneId)) {
      const distance = Math.hypot(self.x - portal.x, self.y - portal.y);
      if (distance <= portal.interactionRange && distance < bestDistance) {
        best = portal;
        bestDistance = distance;
      }
    }
    return best;
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
