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
