import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '../shared/application-error';
import {
  AUTH_RATE_LIMIT_POLICIES,
  AuthRateLimitGuard,
  AuthRateLimiter,
} from './rate-limit.guard';
import type { AuthRateLimitStore } from './rate-limit.store';

class MemoryRateLimitStore implements AuthRateLimitStore {
  private readonly buckets = new Map<
    string,
    { count: number; startedAt: number; expiresAt: number }
  >();

  async increment(key: string, now: Date, windowMs: number): Promise<number> {
    const timestamp = now.getTime();
    const current = this.buckets.get(key);
    if (
      !current ||
      timestamp < current.startedAt ||
      timestamp >= current.expiresAt
    ) {
      this.buckets.set(key, {
        count: 1,
        startedAt: timestamp,
        expiresAt: timestamp + windowMs,
      });
      return 1;
    }
    current.count += 1;
    return current.count;
  }

  async clear(): Promise<void> {
    this.buckets.clear();
  }
}

describe('AuthRateLimiter', () => {
  let store: MemoryRateLimitStore;
  let limiter: AuthRateLimiter;

  beforeEach(() => {
    store = new MemoryRateLimitStore();
    limiter = new AuthRateLimiter(store);
  });

  it('returns stable RATE_LIMITED errors for an IP and normalized email', async () => {
    const policy = AUTH_RATE_LIMIT_POLICIES.loginIdentity;
    for (let attempt = 0; attempt < policy.maxRequests; attempt += 1) {
      await expect(
        limiter.consume(
          'login',
          '127.0.0.1',
          'user@example.com',
          new Date(1_000),
        ),
      ).resolves.toBeUndefined();
    }

    await expect(
      limiter.consume(
        'login',
        '127.0.0.1',
        'user@example.com',
        new Date(1_000),
      ),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      httpStatus: 429,
      message: 'Too many authentication attempts, try again later',
    } satisfies Partial<ApplicationError>);
  });

  it('also applies a coarser limit per login IP', async () => {
    const policy = AUTH_RATE_LIMIT_POLICIES.loginIp;
    for (let attempt = 0; attempt < policy.maxRequests; attempt += 1) {
      await limiter.consume(
        'login',
        '203.0.113.8',
        `user-${attempt}@example.com`,
        new Date(1_000),
      );
    }

    await expect(
      limiter.consume(
        'login',
        '203.0.113.8',
        'another@example.com',
        new Date(1_000),
      ),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', httpStatus: 429 });
  });

  it('shares buckets across limiter instances', async () => {
    const otherReplica = new AuthRateLimiter(store);
    const policy = AUTH_RATE_LIMIT_POLICIES.registerIp;

    for (let attempt = 0; attempt < policy.maxRequests; attempt += 1) {
      await (attempt % 2 === 0 ? limiter : otherReplica).consume(
        'register',
        'same-client',
        null,
        new Date(1_000),
      );
    }

    await expect(
      otherReplica.consume('register', 'same-client', null, new Date(1_000)),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('starts fresh buckets after the fixed window', async () => {
    const policy = AUTH_RATE_LIMIT_POLICIES.registerIp;
    for (let attempt = 0; attempt < policy.maxRequests; attempt += 1) {
      await limiter.consume('register', 'same-client', null, new Date(1_000));
    }

    await expect(
      limiter.consume(
        'register',
        'same-client',
        null,
        new Date(1_000 + policy.windowMs),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('AuthRateLimitGuard', () => {
  it('uses trusted request.ip and normalized login email', async () => {
    const reflector = {
      get: vi.fn().mockReturnValue('login'),
    } as unknown as Reflector;
    const limiter = {
      consume: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthRateLimiter;
    const guard = new AuthRateLimitGuard(reflector, limiter);
    const request = {
      ip: '203.0.113.8',
      body: { email: ' User@Example.COM ' },
      socket: {},
    } as Request;
    const context = {
      getHandler: vi.fn().mockReturnValue(() => undefined),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(limiter.consume).toHaveBeenCalledWith(
      'login',
      '203.0.113.8',
      'user@example.com',
    );
  });
});
