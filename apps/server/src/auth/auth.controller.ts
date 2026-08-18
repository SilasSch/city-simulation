import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthSessionDto } from '@city/shared-types';
import { loginRequestSchema, registerRequestSchema } from '@city/game-protocol';
import { ApplicationError } from '../shared/application-error';
import { AuthService } from './auth.service';
import { CurrentPrincipal } from './authenticated-principal';
import type { AuthenticatedPrincipal } from './authenticated-principal';
import { AuthRateLimited, AuthRateLimitGuard } from './rate-limit.guard';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionCookieService } from './session-cookie.service';

/**
 * REST-Transport für Auth. Validiert Eingaben mit den gemeinsamen
 * Zod-Schemas und delegiert an den AuthService — keine Fachlogik.
 */
@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessionCookie: SessionCookieService,
  ) {}

  @Post('register')
  @AuthRateLimited('register')
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionDto> {
    const data = registerRequestSchema.safeParse(body);
    if (!data.success) {
      throw new ApplicationError(
        'VALIDATION_ERROR',
        400,
        'Invalid registration data',
      );
    }

    const result = await this.auth.register(
      data.data.email,
      data.data.password,
    );
    this.sessionCookie.setCookie(
      response,
      result.sessionToken,
      result.expiresAt,
    );
    response.status(HttpStatus.CREATED);
    return result.body;
  }

  @Post('login')
  @AuthRateLimited('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionDto> {
    const data = loginRequestSchema.safeParse(body);
    if (!data.success) {
      throw new ApplicationError('VALIDATION_ERROR', 400, 'Invalid login data');
    }

    const result = await this.auth.login(data.data.email, data.data.password);
    this.sessionCookie.setCookie(
      response,
      result.sessionToken,
      result.expiresAt,
    );
    return result.body;
  }

  /**
   * Logout ist idempotent und bewusst nicht hinter dem Guard: auch ohne
   * gültige Session wird das Cookie gelöscht, damit der Client einen
   * sauberen Ausgangszustand erreicht.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = this.sessionCookie.readToken(request.headers.cookie);
    if (token) await this.auth.logout(token);
    this.sessionCookie.clearCookie(response);
  }

  @Get('session')
  @UseGuards(SessionAuthGuard)
  getSession(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): AuthSessionDto {
    return {
      userId: principal.userId,
      playerProfileId: principal.playerProfileId,
      email: principal.email,
    };
  }
}
