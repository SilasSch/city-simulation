import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ApplicationError } from '../shared/application-error';
import type { AppConfig } from './config';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF-Schutz für Cookie-authentifizierte REST-Kommandos. Browser setzen bei
 * unsicheren Methoden einen Origin-Header; nur der konfigurierte Client darf
 * solche Requests auslösen. CORS allein verhindert die Ausführung nicht.
 */
@Injectable()
export class ClientOriginGuard implements CanActivate {
  private readonly clientOrigin: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.clientOrigin = config.get('CLIENT_ORIGIN', { infer: true });
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_HTTP_METHODS.has(request.method)) return true;

    if (request.headers.origin !== this.clientOrigin) {
      throw new ApplicationError(
        'ORIGIN_NOT_ALLOWED',
        403,
        'Request origin is not allowed',
      );
    }

    return true;
  }
}
