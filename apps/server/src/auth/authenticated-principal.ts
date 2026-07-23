import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Authentifizierte Identität einer Anfrage oder WebSocket-Verbindung.
 * Wird ausschließlich aus der serverseitig validierten Session abgeleitet —
 * niemals aus vom Client mitgesendeten IDs.
 */
export interface AuthenticatedPrincipal {
  userId: string;
  playerProfileId: string;
  sessionId: string;
  email: string;
}

/** Interner Request-Typ nach erfolgreicher Session-Prüfung. */
export interface AuthenticatedRequest {
  principal: AuthenticatedPrincipal;
}

/**
 * Parameter-Dekorator für Controller: liest das vom SessionAuthGuard
 * gesetzte Principal. Verwendung nur hinter dem Guard sinnvoll.
 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.principal;
  },
);
