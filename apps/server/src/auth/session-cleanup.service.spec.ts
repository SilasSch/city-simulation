import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../persistence/prisma.service';
import {
  SESSION_CLEANUP_INTERVAL_MS,
  SessionCleanupService,
} from './session-cleanup.service';

describe('SessionCleanupService', () => {
  let deleteMany: ReturnType<typeof vi.fn>;
  let service: SessionCleanupService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T12:00:00.000Z'));
    deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      session: { deleteMany },
    } as unknown as PrismaService;
    service = new SessionCleanupService(prisma);
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('deletes already expired sessions during application startup', async () => {
    deleteMany.mockResolvedValueOnce({ count: 2 });

    await service.onApplicationBootstrap();

    expect(deleteMany).toHaveBeenCalledOnce();
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: new Date('2026-08-12T12:00:00.000Z') },
      },
    });
    await expect(
      service.removeExpiredSessions(new Date('2026-08-12T12:00:01.000Z')),
    ).resolves.toBe(0);
  });

  it('runs cleanup periodically and catches maintenance failures', async () => {
    deleteMany
      .mockResolvedValueOnce({ count: 0 })
      .mockRejectedValueOnce(new Error('database temporarily unavailable'))
      .mockResolvedValueOnce({ count: 1 });
    await service.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(SESSION_CLEANUP_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(SESSION_CLEANUP_INTERVAL_MS);

    expect(deleteMany).toHaveBeenCalledTimes(3);
  });

  it('clears the periodic timer during module shutdown', async () => {
    await service.onApplicationBootstrap();
    service.onModuleDestroy();

    await vi.advanceTimersByTimeAsync(SESSION_CLEANUP_INTERVAL_MS * 2);

    expect(deleteMany).toHaveBeenCalledOnce();
  });

  it('does not keep the Node.js process alive for maintenance', async () => {
    const unref = vi.fn();
    const timer = { unref } as unknown as NodeJS.Timeout;
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockReturnValue(timer);

    await service.onApplicationBootstrap();

    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      SESSION_CLEANUP_INTERVAL_MS,
    );
    expect(unref).toHaveBeenCalledOnce();
  });
});
