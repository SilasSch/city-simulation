import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express, RequestHandler } from 'express';
import type { AppConfig } from './config';
import { ClientOriginSocketIoAdapter } from './client-origin-socket-io.adapter';

export const GLOBAL_PREFIX = 'api';

export function buildSecurityHeaders(
  isProduction: boolean,
): Readonly<Record<string, string>> {
  return {
    'Content-Security-Policy':
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0',
    ...(isProduction
      ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
      : {}),
  };
}

function securityHeaders(
  headers: Readonly<Record<string, string>>,
): RequestHandler {
  return (_request, response, next) => {
    for (const [name, value] of Object.entries(headers)) {
      response.setHeader(name, value);
    }
    next();
  };
}

/** Gemeinsamer Netzwerk-Bootstrap für Produktion und Integrationstests. */
export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService<AppConfig, true>);
  const clientOrigin = config.get('CLIENT_ORIGIN', { infer: true });
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';
  const express = app.getHttpAdapter().getInstance() as Express;

  app.setGlobalPrefix(GLOBAL_PREFIX);
  express.disable('x-powered-by');
  app.use(securityHeaders(buildSecurityHeaders(isProduction)));
  app.enableCors({
    credentials: true,
    origin: (
      requestOrigin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) => {
      callback(
        null,
        requestOrigin === undefined || requestOrigin === clientOrigin,
      );
    },
  });
  app.useWebSocketAdapter(new ClientOriginSocketIoAdapter(app, clientOrigin));
}
