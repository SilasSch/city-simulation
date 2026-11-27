import {
  WORLD_MOVE_SPEED,
  WORLD_TICK_SECONDS,
  stepWorldPosition,
  type WorldPoint,
  type WorldZoneId,
} from '@city/game-protocol';

/** Höchstens ein Input pro Server-Tick. */
export const INPUT_SEND_INTERVAL_MS = WORLD_TICK_SECONDS * 1000;
/** Abweichung, die beim Laufen als normale Latenz gilt (≈ 0,3 s Vorsprung). */
export const MAX_MOVING_DRIFT = WORLD_MOVE_SPEED * 0.3;
/** Ab dieser Abweichung wird nicht mehr geblendet, sondern gesetzt. */
export const SNAP_DISTANCE = WORLD_MOVE_SPEED;

const INPUT_EPSILON = 0.01;
const SETTLE_RATE = 10;

export interface SelfAck {
  readonly seq: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Client-Prediction der eigenen Figur (ADR 0015): simuliert mit derselben
 * Bewegungsfunktion und demselben festen Schritt wie der Server-Tick, sendet
 * Inputs gedrosselt und gleicht sanft an bestätigte Server-Positionen an.
 */
export class SelfMovement {
  private current: { x: number; y: number } | null = null;
  private zoneId: WorldZoneId | null = null;
  private sentInput: WorldPoint = { x: 0, y: 0 };
  private sentAt = Number.NEGATIVE_INFINITY;
  private latestSeq: number | null = null;
  private accumulator = 0;
  /** Ziel, auf das die stehende Figur einschwingt (bestätigter Stopp). */
  private settleTarget: WorldPoint | null = null;
  private forceSend = false;

  constructor(private readonly send: (input: WorldPoint) => number | null) {}

  get position(): WorldPoint | null {
    return this.current;
  }

  /** Neuer Weltkontext (Eintritt, Portal): Server-Position übernehmen. */
  reset(position: WorldPoint, zoneId: WorldZoneId): void {
    this.current = { x: position.x, y: position.y };
    this.zoneId = zoneId;
    this.accumulator = 0;
    this.settleTarget = null;
    this.latestSeq = null;
    // Der Server startet stehend: eine gehaltene Richtung erneut senden.
    this.sentInput = { x: 0, y: 0 };
    this.forceSend = true;
  }

  clear(): void {
    this.current = null;
    this.zoneId = null;
  }

  /** Gewünschte Richtung; gesendet wird bei Änderung, höchstens pro Tick. */
  setInput(input: WorldPoint, nowMs: number): void {
    const changed =
      Math.abs(input.x - this.sentInput.x) > INPUT_EPSILON ||
      Math.abs(input.y - this.sentInput.y) > INPUT_EPSILON;
    const stopping = input.x === 0 && input.y === 0;
    if (!changed && !(this.forceSend && !stopping)) return;
    // Stopps sofort senden, Richtungswechsel gedrosselt.
    if (!stopping && nowMs - this.sentAt < INPUT_SEND_INTERVAL_MS) return;

    const seq = this.send(input);
    if (seq === null) return;
    this.latestSeq = seq;
    this.sentInput = input;
    this.sentAt = nowMs;
    this.forceSend = false;
    if (!stopping) this.settleTarget = null;
  }

  /** Feste Simulationsschritte wie im Server-Tick, plus Einschwingen. */
  advance(deltaSeconds: number): void {
    if (!this.current || !this.zoneId) return;

    this.accumulator += deltaSeconds;
    while (this.accumulator >= WORLD_TICK_SECONDS) {
      this.current = stepWorldPosition(
        this.current,
        this.sentInput,
        WORLD_TICK_SECONDS,
        this.zoneId,
      );
      this.accumulator -= WORLD_TICK_SECONDS;
    }

    if (this.settleTarget && this.isIdle()) {
      const blend = 1 - Math.exp(-deltaSeconds * SETTLE_RATE);
      this.current = {
        x: this.current.x + (this.settleTarget.x - this.current.x) * blend,
        y: this.current.y + (this.settleTarget.y - this.current.y) * blend,
      };
    }
  }

  /** Abgleich mit einer bestätigten Server-Position. */
  reconcile(ack: SelfAck): void {
    if (!this.current) return;
    const error = Math.hypot(ack.x - this.current.x, ack.y - this.current.y);

    if (error > SNAP_DISTANCE) {
      this.current = { x: ack.x, y: ack.y };
      this.settleTarget = null;
      return;
    }
    if (this.isIdle() && ack.seq === this.latestSeq) {
      // Stopp ist bestätigt: auf die Server-Position einschwingen.
      this.settleTarget = { x: ack.x, y: ack.y };
      return;
    }
    if (error > MAX_MOVING_DRIFT) {
      // Mehr Abweichung als Latenz erklärt: halb zurückziehen.
      this.current = {
        x: this.current.x + (ack.x - this.current.x) * 0.5,
        y: this.current.y + (ack.y - this.current.y) * 0.5,
      };
    }
  }

  private isIdle(): boolean {
    return this.sentInput.x === 0 && this.sentInput.y === 0;
  }
}
