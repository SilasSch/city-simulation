import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionSocketRegistry } from './session-socket-registry.service';

describe('SessionSocketRegistry', () => {
  let registry: SessionSocketRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));
    registry = new SessionSocketRegistry();
  });

  afterEach(() => {
    registry.onModuleDestroy();
    vi.useRealTimers();
  });

  it('revokes every socket of the same session immediately', () => {
    const first = vi.fn();
    const second = vi.fn();
    registry.register(
      'session-a',
      new Date('2026-01-01T11:00:00.000Z'),
      'socket-a',
      first,
    );
    registry.register(
      'session-a',
      new Date('2026-01-01T11:00:00.000Z'),
      'socket-b',
      second,
    );

    registry.revoke('session-a', 'revoked');

    expect(first).toHaveBeenCalledWith('revoked');
    expect(second).toHaveBeenCalledWith('revoked');
  });

  it('disconnects every tab exactly when the session expires', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const expiresAt = new Date('2026-01-01T10:00:05.000Z');
    registry.register('session-a', expiresAt, 'socket-a', first);
    registry.register('session-a', expiresAt, 'socket-b', second);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(first).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(first).toHaveBeenCalledWith('expired');
    expect(second).toHaveBeenCalledWith('expired');
  });

  it('does not revoke remaining tabs when one socket disconnects', () => {
    const first = vi.fn();
    const second = vi.fn();
    const expiresAt = new Date('2026-01-01T11:00:00.000Z');
    registry.register('session-a', expiresAt, 'socket-a', first);
    registry.register('session-a', expiresAt, 'socket-b', second);

    registry.unregister('socket-a');
    registry.revoke('session-a');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('revoked');
  });
});
