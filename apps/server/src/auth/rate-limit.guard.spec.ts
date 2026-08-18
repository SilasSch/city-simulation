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

describe('AuthRateLimiter', () => {
  let limiter: AuthRateLimiter;

  beforeEach(() => {
    limiter = new AuthRateLimiter();
  });

  it('returns stable RATE_LIMITED errors after the route limit', () => {
    const policy = AUTH_RATE_LIMIT_POLICIES.login;
    for (let attempt = 0; attempt < policy.maxRequests; attempt += 1) {
      expect(() => limiter.consume('login', '127.0.0.1', 1_000)).not.toThrow();
    }

    let thrown: unknown;
    try {
      limiter.consume('login', '127.0.0.1', 1_000);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApplicationError);
    expect(thrown).toMatchObject({
      code: 'RATE_LIMITED',
      httpStatus: 429,
      message: 'Too many authentication attempts, try again later',
    });
  });

  it('keeps login and registration counters independent', () => {
    for (
      let attempt = 0;
      attempt < AUTH_RATE_LIMIT_POLICIES.login.maxRequests;
      attempt += 1
    ) {
      limiter.consume('login', 'same-client', 1_000);
    }

    expect(() =>
      limiter.consume('register', 'same-client', 1_000),
    ).not.toThrow();
    expect(() => limiter.consume('login', 'other-client', 1_000)).not.toThrow();
    expect(() => limiter.consume('login', 'same-client', 1_000)).toThrowError(
      ApplicationError,
    );
  });

  it('starts a fresh bucket after the fixed window', () => {
    const policy = AUTH_RATE_LIMIT_POLICIES.register;
    for (let attempt = 0; attempt < policy.maxRequests; attempt += 1) {
      limiter.consume('register', 'same-client', 1_000);
    }

    expect(() =>
      limiter.consume('register', 'same-client', 1_000 + policy.windowMs),
    ).not.toThrow();
  });

  it('prunes stale buckets while consuming authentication attempts', () => {
    const prune = vi.spyOn(limiter, 'prune');

    limiter.consume('login', 'same-client', 1_000);

    expect(prune).toHaveBeenCalledWith(1_000);
  });

  it('prunes expired buckets', () => {
    limiter.consume('login', 'same-client', 1_000);
    limiter.prune(1_000 + AUTH_RATE_LIMIT_POLICIES.login.windowMs);

    for (
      let attempt = 0;
      attempt < AUTH_RATE_LIMIT_POLICIES.login.maxRequests;
      attempt += 1
    ) {
      expect(() =>
        limiter.consume('login', 'same-client', 2_000),
      ).not.toThrow();
    }
  });
});

describe('AuthRateLimitGuard', () => {
  it('consumes the route-specific bucket before activating the handler', () => {
    const reflector = {
      get: vi.fn().mockReturnValue('login'),
    } as unknown as Reflector;
    const limiter = {
      consume: vi.fn(),
    } as unknown as AuthRateLimiter;
    const guard = new AuthRateLimitGuard(reflector, limiter);
    const request = {
      ip: '203.0.113.8',
      socket: {},
    } as Request;
    const context = {
      getHandler: vi.fn().mockReturnValue(() => undefined),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
    expect(limiter.consume).toHaveBeenCalledWith('login', '203.0.113.8');
  });
});
