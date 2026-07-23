import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { parse, serialize } from 'cookie';
import type { AppConfig } from '../core/config';

export const SESSION_COOKIE_NAME = 'city_session';

/**
 * Transportdetails des Session-Cookies an einer Stelle: HTTP-only,
 * SameSite=Lax, konfigurierbares Secure-Flag, Ablauf deckungsgleich mit
 * der serverseitigen Session. Das Cookie enthält nur das opaque Token —
 * keine fachlichen Daten (ADR 0007).
 */
@Injectable()
export class SessionCookieService {
  readonly name = SESSION_COOKIE_NAME;

  private readonly secure: boolean;

  constructor(config: ConfigService<AppConfig, true>) {
    this.secure = config.get('SESSION_COOKIE_SECURE', { infer: true });
  }

  /** Liest das Session-Token aus einem Cookie-Header (REST oder WS-Handshake). */
  readToken(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    const token = parse(cookieHeader)[this.name];
    return token && token.length > 0 ? token : null;
  }

  setCookie(response: Response, token: string, expiresAt: Date): void {
    response.setHeader(
      'Set-Cookie',
      serialize(this.name, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.secure,
        path: '/',
        expires: expiresAt,
      }),
    );
  }

  clearCookie(response: Response): void {
    response.setHeader(
      'Set-Cookie',
      serialize(this.name, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.secure,
        path: '/',
        expires: new Date(0),
      }),
    );
  }
}
