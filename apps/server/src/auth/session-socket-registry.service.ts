import { Injectable, OnModuleDestroy } from '@nestjs/common';

export type SessionSocketDisconnectReason = 'revoked' | 'expired';
type DisconnectSocket = (reason: SessionSocketDisconnectReason) => void;

interface SessionSockets {
  expiresAt: Date;
  sockets: Map<string, DisconnectSocket>;
  timer: NodeJS.Timeout;
}

const MAX_TIMER_DELAY_MS = 2_147_000_000;

/**
 * Verknüpft eine bereits in PostgreSQL validierte Session mit allen lokalen
 * Sockets. Der normale Command-Pfad bleibt datenbankfrei; Logout und Ablauf
 * invalidieren stattdessen aktiv alle zugehörigen Verbindungen.
 */
@Injectable()
export class SessionSocketRegistry implements OnModuleDestroy {
  private readonly sessions = new Map<string, SessionSockets>();
  private readonly sessionBySocket = new Map<string, string>();

  register(
    sessionId: string,
    expiresAt: Date,
    socketId: string,
    disconnect: DisconnectSocket,
  ): void {
    this.unregister(socketId);
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      entry = {
        expiresAt,
        sockets: new Map(),
        timer: this.scheduleExpiry(sessionId, expiresAt),
      };
      this.sessions.set(sessionId, entry);
    }
    entry.sockets.set(socketId, disconnect);
    this.sessionBySocket.set(socketId, sessionId);
  }

  unregister(socketId: string): void {
    const sessionId = this.sessionBySocket.get(socketId);
    if (!sessionId) return;
    this.sessionBySocket.delete(socketId);

    const entry = this.sessions.get(sessionId);
    entry?.sockets.delete(socketId);
    if (entry && entry.sockets.size === 0) {
      clearTimeout(entry.timer);
      this.sessions.delete(sessionId);
    }
  }

  revoke(
    sessionId: string,
    reason: SessionSocketDisconnectReason = 'revoked',
  ): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.sessions.delete(sessionId);
    for (const socketId of entry.sockets.keys()) {
      this.sessionBySocket.delete(socketId);
    }
    for (const disconnect of entry.sockets.values()) disconnect(reason);
  }

  onModuleDestroy(): void {
    for (const entry of this.sessions.values()) clearTimeout(entry.timer);
    this.sessions.clear();
    this.sessionBySocket.clear();
  }

  private scheduleExpiry(sessionId: string, expiresAt: Date): NodeJS.Timeout {
    const remaining = expiresAt.getTime() - Date.now();
    const delay = Math.max(0, Math.min(remaining, MAX_TIMER_DELAY_MS));
    const timer = setTimeout(() => {
      if (expiresAt.getTime() > Date.now()) {
        const entry = this.sessions.get(sessionId);
        if (entry) entry.timer = this.scheduleExpiry(sessionId, expiresAt);
        return;
      }
      this.revoke(sessionId, 'expired');
    }, delay);
    timer.unref();
    return timer;
  }
}
