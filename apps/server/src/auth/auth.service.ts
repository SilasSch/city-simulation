import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AuthSessionDto } from '@city/shared-types';
import type { AppConfig } from '../core/config';
import { PrismaService } from '../persistence/prisma.service';
import { ApplicationError } from '../shared/application-error';
import type { AuthenticatedPrincipal } from './authenticated-principal';
import { PasswordHasherService } from './password-hasher.service';
import { SessionSocketRegistry } from './session-socket-registry.service';

/** Ergebnis von register/login: DTO für den Body + Token für das Cookie. */
export interface AuthResult {
  body: AuthSessionDto;
  sessionToken: string;
  expiresAt: Date;
}

export interface ResolvedSession {
  principal: AuthenticatedPrincipal;
  expiresAt: Date;
}

export type SessionResolution =
  | { status: 'ok'; session: ResolvedSession }
  | { status: 'invalid' }
  | { status: 'expired' };

/**
 * Fachliche Auth-Abläufe: Registrierung, Login, Session-Auflösung, Logout.
 * Die konkrete Transportmethode (HTTP-only Cookie) ist dem Rest der
 * Fachlogik egal — Module sehen nur das AuthenticatedPrincipal (ADR 0007).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly sessionTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasherService,
    private readonly socketSessions: SessionSocketRegistry,
    config: ConfigService<AppConfig, true>,
  ) {
    this.sessionTtlMs =
      config.get('SESSION_TTL_HOURS', { infer: true }) * 60 * 60 * 1000;
  }

  /** Erzeugt User und PlayerProfile atomar und startet eine Session. */
  async register(email: string, password: string): Promise<AuthResult> {
    const passwordHash = await this.hasher.hash(password);

    let user: { id: string; email: string };
    let playerProfile: { id: string };
    try {
      // Zwei flache Creates statt nested create: die Prisma-Engine
      // (6.19.x) verliert bei verschachtelten Creates über der zyklischen
      // PlayerProfile↔Character-Relation die UUID-Defaults des Parents.
      [user, playerProfile] = await this.prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: { email, passwordHash },
          select: { id: true, email: true },
        });
        const createdProfile = await tx.playerProfile.create({
          data: { userId: createdUser.id },
          select: { id: true },
        });
        return [createdUser, createdProfile];
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApplicationError(
          'EMAIL_ALREADY_TAKEN',
          409,
          'A user with this email already exists',
        );
      }
      throw error;
    }

    this.logger.log({ event: 'user-registered', userId: user.id });
    return this.startSession({
      userId: user.id,
      playerProfileId: playerProfile.id,
      email: user.email,
    });
  }

  /** Prüft Zugangsdaten und startet eine Session. */
  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        playerProfile: { select: { id: true } },
      },
    });

    // Bewusst identischer Fehler für unbekannte E-Mail und falsches
    // Passwort: keine Account-Existenz-Leaks (ADR 0007). Auch ohne User
    // läuft eine echte Argon2-Prüfung gegen einen Dummy-Hash.
    const passwordValid = await this.hasher.verifyLoginPassword(
      user?.passwordHash ?? null,
      password,
    );
    const credentialsValid =
      user !== null && user.playerProfile !== null && passwordValid;

    if (!credentialsValid || !user.playerProfile) {
      this.logger.log({
        event: 'user-login-failed',
        reason: 'invalid-credentials',
      });
      throw new ApplicationError(
        'INVALID_CREDENTIALS',
        401,
        'Invalid email or password',
      );
    }

    this.logger.log({ event: 'user-logged-in', userId: user.id });
    return this.startSession({
      userId: user.id,
      playerProfileId: user.playerProfile.id,
      email: user.email,
    });
  }

  /**
   * Löst ein Session-Token in die authentifizierte Identität auf.
   * Einzige Quelle für Benutzeridentität in Guards und Gateways.
   */
  async resolvePrincipal(token: string): Promise<SessionResolution> {
    const session = await this.prisma.session.findUnique({
      where: { id: token },
      select: {
        expiresAt: true,
        user: {
          select: {
            id: true,
            email: true,
            playerProfile: { select: { id: true } },
          },
        },
      },
    });

    if (!session?.user.playerProfile) return { status: 'invalid' };

    if (session.expiresAt.getTime() <= Date.now()) {
      // Abgelaufene Sessions werden beim Zugriff entfernt (lazy cleanup).
      await this.prisma.session.deleteMany({ where: { id: token } });
      this.socketSessions.revoke(token, 'expired');
      this.logger.log({
        event: 'session-expired',
        userId: session.user.id,
      });
      return { status: 'expired' };
    }

    return {
      status: 'ok',
      session: {
        principal: {
          userId: session.user.id,
          playerProfileId: session.user.playerProfile.id,
          sessionId: token,
          email: session.user.email,
        },
        expiresAt: session.expiresAt,
      },
    };
  }

  /** Macht eine Session serverseitig ungültig (idempotent). */
  async logout(token: string): Promise<void> {
    if (await this.revokeSession(token)) {
      this.logger.log({ event: 'user-logged-out' });
    }
  }

  /**
   * Gemeinsamer Widerrufspfad für Logout und administrative Aufrufer:
   * erst persistent löschen, dann alle lokal registrierten Sockets trennen.
   */
  async revokeSession(token: string): Promise<boolean> {
    const deleted = await this.prisma.session.deleteMany({
      where: { id: token },
    });
    this.socketSessions.revoke(token, 'revoked');
    return deleted.count > 0;
  }

  private async startSession(user: {
    userId: string;
    playerProfileId: string;
    email: string;
  }): Promise<AuthResult> {
    // 256 Bit Entropie: nicht erratbar, kein Inhalt außer Zufall.
    const sessionToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);

    await this.prisma.session.create({
      data: { id: sessionToken, userId: user.userId, expiresAt },
    });

    return {
      body: {
        userId: user.userId,
        playerProfileId: user.playerProfileId,
        email: user.email,
      },
      sessionToken,
      expiresAt,
    };
  }
}
