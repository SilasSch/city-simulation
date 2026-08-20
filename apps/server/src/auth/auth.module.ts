import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordHasherService } from './password-hasher.service';
import { AuthRateLimiter, AuthRateLimitGuard } from './rate-limit.guard';
import {
  AUTH_RATE_LIMIT_STORE,
  PrismaAuthRateLimitStore,
} from './rate-limit.store';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionCleanupService } from './session-cleanup.service';
import { SessionCookieService } from './session-cookie.service';
import { SessionSocketRegistry } from './session-socket-registry.service';

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
    PrismaAuthRateLimitStore,
    {
      provide: AUTH_RATE_LIMIT_STORE,
      useExisting: PrismaAuthRateLimitStore,
    },
    AuthRateLimiter,
    AuthRateLimitGuard,
    SessionCookieService,
    SessionSocketRegistry,
    SessionAuthGuard,
    SessionCleanupService,
  ],
  exports: [
    AuthService,
    SessionCookieService,
    SessionSocketRegistry,
    SessionAuthGuard,
  ],
})
export class AuthModule {}
