import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordHasherService } from './password-hasher.service';
import { AuthRateLimiter, AuthRateLimitGuard } from './rate-limit.guard';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionCleanupService } from './session-cleanup.service';
import { SessionCookieService } from './session-cookie.service';

/**
 * Identity-Modul: User Accounts, Sessions, Passwort-Hashing.
 * Exportiert Guard + Services, damit Fachmodule (character, realtime)
 * authentifizierte Identitäten nutzen können, ohne Auth-Internals zu kennen.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordHasherService,
    AuthRateLimiter,
    AuthRateLimitGuard,
    SessionCookieService,
    SessionAuthGuard,
    SessionCleanupService,
  ],
  exports: [AuthService, SessionCookieService, SessionAuthGuard],
})
export class AuthModule {}
