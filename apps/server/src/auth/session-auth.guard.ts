import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApplicationError } from '../shared/application-error';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './authenticated-principal';
import { SessionCookieService } from './session-cookie.service';

/**
 * Schützt REST-Endpunkte: liest das Session-Cookie, löst es über den
 * AuthService auf und stellt das AuthenticatedPrincipal im Request bereit.
 * Enthält keine Fachlogik und keinen Datenbankzugriff.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly sessionCookie: SessionCookieService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & Partial<AuthenticatedRequest>>();

    const token = this.sessionCookie.readToken(request.headers.cookie);
    if (!token) {
      throw new ApplicationError(
        'AUTHENTICATION_REQUIRED',
        401,
        'Authentication required',
      );
    }

    const resolution = await this.auth.resolvePrincipal(token);
    if (resolution.status === 'expired') {
      throw new ApplicationError('SESSION_EXPIRED', 401, 'Session expired');
    }
    if (resolution.status !== 'ok') {
      throw new ApplicationError(
        'AUTHENTICATION_REQUIRED',
        401,
        'Authentication required',
      );
    }

    request.principal = resolution.session.principal;
    return true;
  }
}
