import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { ApplicationError } from '../shared/application-error';
import {
  AUTH_RATE_LIMIT_STORE,
  type AuthRateLimitStore,
} from './rate-limit.store';

export type AuthRateLimitRoute = 'register' | 'login';

export const AUTH_RATE_LIMIT_POLICIES = {
  registerIp: { maxRequests: 3, windowMs: 60_000 },
  loginIp: { maxRequests: 20, windowMs: 60_000 },
  loginIdentity: { maxRequests: 5, windowMs: 60_000 },
} as const;

const AUTH_RATE_LIMIT_ROUTE = Symbol('AUTH_RATE_LIMIT_ROUTE');

export const AuthRateLimited = (route: AuthRateLimitRoute): MethodDecorator =>
  SetMetadata(AUTH_RATE_LIMIT_ROUTE, route);

function bucketKey(scope: string, value: string): string {
  return createHash('sha256').update(`${scope}:${value}`).digest('hex');
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 254) : null;
}

/**
 * Replikaübergreifender Auth-Limiter. Der injizierte Store führt atomare
 * Inkremente in PostgreSQL aus; weder IPs noch E-Mail-Adressen werden im
 * Klartext als Bucket-Schlüssel persistiert.
 */
@Injectable()
export class AuthRateLimiter {
  constructor(
    @Inject(AUTH_RATE_LIMIT_STORE)
    private readonly store: AuthRateLimitStore,
  ) {}

  async consume(
    route: AuthRateLimitRoute,
    clientIp: string,
    normalizedEmail?: string | null,
    now = new Date(),
  ): Promise<void> {
    if (route === 'register') {
      await this.consumeBucket(
        'register-ip',
        clientIp,
        AUTH_RATE_LIMIT_POLICIES.registerIp,
        now,
      );
      return;
    }

    await this.consumeBucket(
      'login-ip',
      clientIp,
      AUTH_RATE_LIMIT_POLICIES.loginIp,
      now,
    );
    if (normalizedEmail) {
      await this.consumeBucket(
        'login-identity',
        `${clientIp}:${normalizedEmail}`,
        AUTH_RATE_LIMIT_POLICIES.loginIdentity,
        now,
      );
    }
  }

  clear(): Promise<void> {
    return this.store.clear();
  }

  private async consumeBucket(
    scope: string,
    value: string,
    policy: { maxRequests: number; windowMs: number },
    now: Date,
  ): Promise<void> {
    const count = await this.store.increment(
      bucketKey(scope, value),
      now,
      policy.windowMs,
    );
    if (count > policy.maxRequests) {
      throw new ApplicationError(
        'RATE_LIMITED',
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many authentication attempts, try again later',
      );
    }
  }
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: AuthRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const route = this.reflector.get<AuthRateLimitRoute>(
      AUTH_RATE_LIMIT_ROUTE,
      context.getHandler(),
    );
    if (route === undefined) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const clientIp =
      request.ip ?? request.socket.remoteAddress ?? 'unknown-client';
    await this.limiter.consume(
      route,
      clientIp,
      route === 'login'
        ? normalizeEmail((request.body as Record<string, unknown>)?.['email'])
        : null,
    );
    return true;
  }
}
