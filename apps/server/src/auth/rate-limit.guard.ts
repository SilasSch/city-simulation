import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApplicationError } from '../shared/application-error';

export type AuthRateLimitRoute = 'register' | 'login';

export const AUTH_RATE_LIMIT_POLICIES = {
  register: { maxRequests: 3, windowMs: 60_000 },
  login: { maxRequests: 5, windowMs: 60_000 },
} as const satisfies Record<
  AuthRateLimitRoute,
  { maxRequests: number; windowMs: number }
>;

const AUTH_RATE_LIMIT_ROUTE = Symbol('AUTH_RATE_LIMIT_ROUTE');

/** Markiert einen Auth-Endpunkt für sein eigenes, IP-basiertes Limit. */
export const AuthRateLimited = (route: AuthRateLimitRoute): MethodDecorator =>
  SetMetadata(AUTH_RATE_LIMIT_ROUTE, route);

interface RateLimitBucket {
  count: number;
  startedAt: number;
}

/**
 * Prozesslokaler Fixed-Window-Limiter. Die Buckets sind pro Route getrennt,
 * damit z. B. Login-Versuche nicht das Registrierungs-Limit verbrauchen.
 *
 * Für mehrere Server-Instanzen muss diese Implementierung später durch
 * einen gemeinsamen Store ersetzt werden; der Guard-Vertrag bleibt dabei
 * unverändert.
 */
@Injectable()
export class AuthRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  consume(
    route: AuthRateLimitRoute,
    clientKey: string,
    now = Date.now(),
  ): void {
    this.prune(now);
    const policy = AUTH_RATE_LIMIT_POLICIES[route];
    const key = `${route}:${clientKey}`;
    const current = this.buckets.get(key);

    if (
      current === undefined ||
      now < current.startedAt ||
      now - current.startedAt >= policy.windowMs
    ) {
      this.buckets.set(key, { count: 1, startedAt: now });
      return;
    }

    if (current.count >= policy.maxRequests) {
      throw new ApplicationError(
        'RATE_LIMITED',
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many authentication attempts, try again later',
      );
    }

    current.count += 1;
  }

  /** Entfernt abgelaufene Buckets und begrenzt so den Speicherverbrauch. */
  prune(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      const route = key.slice(0, key.indexOf(':')) as AuthRateLimitRoute;
      if (
        now < bucket.startedAt ||
        now - bucket.startedAt >= AUTH_RATE_LIMIT_POLICIES[route].windowMs
      ) {
        this.buckets.delete(key);
      }
    }
  }

  /** Test-Hook; Produktion startet ohnehin mit einem leeren Prozessspeicher. */
  clear(): void {
    this.buckets.clear();
  }
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: AuthRateLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const route = this.reflector.get<AuthRateLimitRoute>(
      AUTH_RATE_LIMIT_ROUTE,
      context.getHandler(),
    );
    if (route === undefined) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const clientKey =
      request.ip ?? request.socket.remoteAddress ?? 'unknown-client';
    this.limiter.consume(route, clientKey);
    return true;
  }
}
