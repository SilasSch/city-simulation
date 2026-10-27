import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  WORLD_TICK_SECONDS,
  clampWorldInput,
  stepWorldPosition,
  type WorldInputPayload,
  type WorldPositionsPayload,
  type WorldZoneId,
} from '@city/game-protocol';
import { ApplicationError } from '../shared/application-error';
import { WorldRepository } from './world.repository';

/** Zonen-Tick mit 20 Hz (ADR 0015). */
export const WORLD_TICK_INTERVAL_MS = WORLD_TICK_SECONDS * 1000;
/** Regelmäßige Persistenz veränderter Positionen (ADR 0015). */
export const WORLD_POSITION_FLUSH_INTERVAL_MS = 5_000;
/** Erlaubte Inputs pro Character und Sekunde (Client sendet höchstens 20). */
export const WORLD_MAX_INPUTS_PER_SECOND = 40;

const MOVEMENT_EPSILON = 1e-6;

/** Ergebnis eines Ticks: Broadcasts je Zone und beendete Interaktionen. */
export interface WorldTickResult {
  zones: Map<WorldZoneId, WorldPositionsPayload['entities']>;
  abortedInteractions: string[];
}

interface LivePosition {
  zoneId: WorldZoneId;
  x: number;
  y: number;
  inputX: number;
  inputY: number;
  /** Zuletzt angenommene Input-Sequenz. */
  seq: number;
  /** Zuletzt an die Zone gemeldete Sequenz. */
  broadcastSeq: number;
  dirty: boolean;
  interacting: boolean;
  inputWindowStartedAt: number;
  inputsInWindow: number;
}

/**
 * Prozesslokale, serverautoritäre Positionen aller eingetretenen Characters.
 * Ein 20-Hz-Tick wendet die zuletzt gemeldete Bewegungsabsicht mit der
 * gemeinsamen Bewegungsfunktion an; PostgreSQL erhält Positionen nur
 * periodisch und an fachlichen Grenzen (ADR 0015).
 */
@Injectable()
export class WorldPositionService
  implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown
{
  private readonly logger = new Logger(WorldPositionService.name);
  private readonly positions = new Map<string, LivePosition>();
  private readonly tickListeners = new Set<(result: WorldTickResult) => void>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly worlds: WorldRepository) {}

  onModuleInit(): void {
    this.tickTimer = setInterval(() => {
      const result = this.tick();
      for (const listener of this.tickListeners) listener(result);
    }, WORLD_TICK_INTERVAL_MS);
    this.tickTimer.unref();
    this.flushTimer = setInterval(() => {
      void this.flushAll();
    }, WORLD_POSITION_FLUSH_INTERVAL_MS);
    this.flushTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.tickTimer = null;
    this.flushTimer = null;
  }

  /** Letzter Flush beim Graceful Shutdown, solange Prisma noch verbunden ist. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.flushAll();
  }

  /** Meldet jeden Tick an den Transport (Broadcast, Interaktionsabbruch). */
  onTick(listener: (result: WorldTickResult) => void): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  /** Übernimmt eine bestätigte, persistierte Position; die Figur steht still. */
  track(
    characterId: string,
    zoneId: WorldZoneId,
    x: number,
    y: number,
    interacting: boolean,
  ): void {
    this.positions.set(characterId, {
      zoneId,
      x,
      y,
      inputX: 0,
      inputY: 0,
      seq: 0,
      broadcastSeq: 0,
      dirty: false,
      interacting,
      inputWindowStartedAt: 0,
      inputsInWindow: 0,
    });
  }

  position(
    characterId: string,
  ): { zoneId: WorldZoneId; x: number; y: number } | null {
    const live = this.positions.get(characterId);
    return live ? { zoneId: live.zoneId, x: live.x, y: live.y } : null;
  }

  markInteracting(characterId: string, interacting: boolean): void {
    const live = this.positions.get(characterId);
    if (live) live.interacting = interacting;
  }

  /**
   * Übernimmt eine Bewegungsabsicht für die folgenden Ticks. Veraltete
   * Sequenzen und Inputs für eine andere Zone (Portalwechsel im Flug) werden
   * still ignoriert, damit der Socket seinen Weltkontext nicht verliert.
   */
  setInput(
    characterId: string,
    zoneId: WorldZoneId,
    input: WorldInputPayload,
    now = Date.now(),
  ): void {
    const live = this.positions.get(characterId);
    if (!live) {
      throw new ApplicationError(
        'WORLD_NOT_ENTERED',
        409,
        'Enter the world before moving',
      );
    }
    if (live.zoneId !== zoneId || input.seq <= live.seq) return;

    if (now - live.inputWindowStartedAt >= 1_000) {
      live.inputWindowStartedAt = now;
      live.inputsInWindow = 0;
    }
    live.inputsInWindow += 1;
    if (live.inputsInWindow > WORLD_MAX_INPUTS_PER_SECOND) {
      throw new ApplicationError('RATE_LIMITED', 429, 'Too many inputs');
    }

    const direction = clampWorldInput(input);
    live.inputX = direction.x;
    live.inputY = direction.y;
    live.seq = input.seq;
  }

  /** Ein fester Simulationsschritt für alle Characters. */
  tick(): WorldTickResult {
    const result: WorldTickResult = {
      zones: new Map(),
      abortedInteractions: [],
    };

    for (const [characterId, live] of this.positions) {
      let moved = false;
      if (live.inputX !== 0 || live.inputY !== 0) {
        const next = stepWorldPosition(
          live,
          { x: live.inputX, y: live.inputY },
          WORLD_TICK_SECONDS,
          live.zoneId,
        );
        moved =
          Math.abs(next.x - live.x) > MOVEMENT_EPSILON ||
          Math.abs(next.y - live.y) > MOVEMENT_EPSILON;
        if (moved) {
          live.x = next.x;
          live.y = next.y;
          live.dirty = true;
          if (live.interacting) {
            live.interacting = false;
            result.abortedInteractions.push(characterId);
          }
        }
      }

      if (!moved && live.seq === live.broadcastSeq) continue;
      live.broadcastSeq = live.seq;
      const entries = result.zones.get(live.zoneId) ?? [];
      entries.push({ characterId, x: live.x, y: live.y, seq: live.seq });
      result.zones.set(live.zoneId, entries);
    }
    return result;
  }

  /** Schreibt eine veränderte Position sofort nach PostgreSQL. */
  async flush(characterId: string): Promise<void> {
    const live = this.positions.get(characterId);
    if (!live?.dirty) return;

    const { zoneId, x, y } = live;
    live.dirty = false;
    try {
      await this.worlds.savePosition(characterId, zoneId, x, y);
    } catch (error) {
      live.dirty = true;
      throw error;
    }
  }

  async flushAll(): Promise<void> {
    for (const characterId of [...this.positions.keys()]) {
      try {
        await this.flush(characterId);
      } catch (error) {
        this.logger.error(
          `World position flush failed for ${characterId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /** Persistiert und entfernt einen Character, der die Welt verlässt. */
  async untrack(characterId: string): Promise<void> {
    const live = this.positions.get(characterId);
    if (live) {
      live.inputX = 0;
      live.inputY = 0;
    }
    await this.flush(characterId);
    this.positions.delete(characterId);
  }
}
