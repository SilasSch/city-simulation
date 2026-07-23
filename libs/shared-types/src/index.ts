/**
 * Framework-unabhängige Typen für technische Verträge zwischen Client und Server.
 * Keine Angular-, NestJS-, Prisma- oder Socket.IO-Abhängigkeiten.
 */

export type HealthStatus = 'ok' | 'error';

export type ComponentHealth = 'up' | 'down';

/**
 * Antwort des REST-Health-Endpunkts (GET /api/health).
 * HTTP 200 bei status 'ok', HTTP 503 bei status 'error'.
 */
export interface HealthResponseDto {
  status: HealthStatus;
  server: 'up';
  database: ComponentHealth;
  timestamp: string;
}

/**
 * Antwort von POST /api/auth/register, POST /api/auth/login und
 * GET /api/auth/session. Enthält niemals Passwort oder Session-Token —
 * die Session läuft ausschließlich über das HTTP-only Cookie.
 */
export interface AuthSessionDto {
  userId: string;
  playerProfileId: string;
  email: string;
}

/**
 * Öffentliche Charakterdarstellung an der Systemgrenze. Bewusst ohne
 * playerProfileId: Besitzerverhältnisse entscheidet allein der Server.
 */
export interface CharacterDto {
  id: string;
  name: string;
  createdAt: string;
}
