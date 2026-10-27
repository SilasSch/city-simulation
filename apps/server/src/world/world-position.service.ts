import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  WORLD_MOVE_STEP,
  isWorldPositionWalkable,
  type WorldDirection,
  type WorldZoneId,
} from '@city/game-protocol';
import { ApplicationError } from '../shared/application-error';
import { WorldRepository } from './world.repository';

/** Zonen-Tick mit 20 Hz (ADR 0015). */
export const WORLD_TICK_INTERVAL_MS = 50;
/** Regelmäßige Persistenz veränderter Positionen (ADR 0015). */
export const WORLD_POSITION_FLUSH_INTERVAL_MS = 5_000;
/** Mehr wartende Schritte pro Character werden abgelehnt. */
export const WORLD_MAX_QUEUED_MOVES = 4;

/** Ergebnis eines im Tick angewendeten Schritts. */
export interface WorldPositionChange {
  characterId: string;
  zoneId: WorldZoneId;
  x: number;
  y: number;
  /** Der Schritt hat eine laufende Interaktion beendet. */
  abortedInteraction: boolean;
}

interface PendingMove {
  direction: WorldDirection;
  resolve: (change: WorldPositionChange) => void;
  reject: (error: ApplicationError) => void;
}

interface LivePosition {
  zoneId: WorldZoneId;
  x: number;
  y: number;
  dirty: boolean;
  interacting: boolean;
  queue: PendingMove[];
}

function nextPosition(
  x: number,
  y: number,
  direction: WorldDirection,
): { x: number; y: number } {
  switch (direction) {
    case 'N':
      return { x, y: y - WORLD_MOVE_STEP };
    case 'E':
      return { x: x + WORLD_MOVE_STEP, y };
    case 'S':
      return { x, y: y + WORLD_MOVE_STEP };
    case 'W':
      return { x: x - WORLD_MOVE_STEP, y };
  }
}

function notEntered(): ApplicationError {
  return new ApplicationError(
    'WORLD_NOT_ENTERED',
    409,
    'Enter the world before moving',
  );
}

/**
 * Prozesslokale, serverautoritäre Positionen aller eingetretenen Characters.
 * Bewegungs-Commands werden im 20-Hz-Tick angewendet; PostgreSQL erhält
 * Positionen nur noch periodisch und an fachlichen Grenzen (ADR 0015).
 */
@Injectable()
export class WorldPositionService
  implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown
{
  private readonly logger = new Logger(WorldPositionService.name);
  private readonly positions = new Map<string, LivePosition>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly worlds: WorldRepository) {}

  onModuleInit(): void {
    this.tickTimer = setInterval(() => this.tick(), WORLD_TICK_INTERVAL_MS);
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

  /** Übernimmt eine bestätigte, persistierte Position in den Tick. */
  track(
    characterId: string,
    zoneId: WorldZoneId,
    x: number,
    y: number,
    interacting: boolean,
  ): void {
    this.rejectQueue(this.positions.get(characterId));
    this.positions.set(characterId, {
      zoneId,
      x,
      y,
      dirty: false,
      interacting,
      queue: [],
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

  /** Reiht einen Schritt ein; das Promise erfüllt sich im nächsten Tick. */
  enqueue(
    characterId: string,
    zoneId: WorldZoneId,
    direction: WorldDirection,
  ): Promise<WorldPositionChange> {
    const live = this.positions.get(characterId);
    if (!live || live.zoneId !== zoneId) {
      return Promise.reject(notEntered());
    }
    if (live.queue.length >= WORLD_MAX_QUEUED_MOVES) {
      return Promise.reject(
        new ApplicationError('RATE_LIMITED', 429, 'Too many queued moves'),
      );
    }
    return new Promise((resolve, reject) => {
      live.queue.push({ direction, resolve, reject });
    });
  }

  /** Wendet pro Character höchstens einen wartenden Schritt an. */
  tick(): void {
    for (const [characterId, live] of this.positions) {
      const move = live.queue.shift();
      if (!move) continue;

      const next = nextPosition(live.x, live.y, move.direction);
      if (!isWorldPositionWalkable(next.x, next.y, live.zoneId)) {
        move.reject(
          new ApplicationError(
            'WORLD_MOVE_BLOCKED',
            409,
            'Movement is blocked by the zone map',
          ),
        );
        continue;
      }

      const abortedInteraction = live.interacting;
      live.x = next.x;
      live.y = next.y;
      live.dirty = true;
      live.interacting = false;
      move.resolve({
        characterId,
        zoneId: live.zoneId,
        x: live.x,
        y: live.y,
        abortedInteraction,
      });
    }
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
    await this.flush(characterId);
    this.rejectQueue(this.positions.get(characterId));
    this.positions.delete(characterId);
  }

  private rejectQueue(live: LivePosition | undefined): void {
    if (!live) return;
    for (const move of live.queue.splice(0)) move.reject(notEntered());
  }
}
