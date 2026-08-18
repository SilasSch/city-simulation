import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';

export const SESSION_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Entfernt abgelaufene Sessions beim Start und danach periodisch. Die
 * Zugriffspfade behalten zusätzlich ihr Lazy-Cleanup, damit ein abgelaufenes
 * Token unabhängig vom Wartungsintervall sofort ungültig ist.
 */
@Injectable()
export class SessionCleanupService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SessionCleanupService.name);
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.removeExpiredSessions();

    this.cleanupTimer = setInterval(() => {
      void this.removeExpiredSessions().catch((error: unknown) => {
        this.logger.error(
          'Periodic expired-session cleanup failed',
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, SESSION_CLEANUP_INTERVAL_MS);
    // Der Wartungstimer darf einen regulären Prozess-Shutdown nicht blockieren.
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  async removeExpiredSessions(now = new Date()): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: {
        expiresAt: { lte: now },
      },
    });

    if (result.count > 0) {
      this.logger.log({
        event: 'expired-sessions-removed',
        count: result.count,
      });
    }
    return result.count;
  }
}
