import { Injectable } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';

export interface AuthRateLimitStore {
  increment(key: string, now: Date, windowMs: number): Promise<number>;
  clear(): Promise<void>;
}

export const AUTH_RATE_LIMIT_STORE = Symbol('AUTH_RATE_LIMIT_STORE');

@Injectable()
export class PrismaAuthRateLimitStore implements AuthRateLimitStore {
  constructor(private readonly prisma: PrismaService) {}

  async increment(key: string, now: Date, windowMs: number): Promise<number> {
    await this.prisma.authRateLimitBucket.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    const expiresAt = new Date(now.getTime() + windowMs);
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "AuthRateLimitBucket"
        ("key", "count", "windowStartedAt", "expiresAt")
      VALUES
        (${key}, 1, ${now}, ${expiresAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN ${now} < "AuthRateLimitBucket"."windowStartedAt"
            OR ${now} >= "AuthRateLimitBucket"."expiresAt"
          THEN 1
          ELSE "AuthRateLimitBucket"."count" + 1
        END,
        "windowStartedAt" = CASE
          WHEN ${now} < "AuthRateLimitBucket"."windowStartedAt"
            OR ${now} >= "AuthRateLimitBucket"."expiresAt"
          THEN ${now}
          ELSE "AuthRateLimitBucket"."windowStartedAt"
        END,
        "expiresAt" = CASE
          WHEN ${now} < "AuthRateLimitBucket"."windowStartedAt"
            OR ${now} >= "AuthRateLimitBucket"."expiresAt"
          THEN ${expiresAt}
          ELSE "AuthRateLimitBucket"."expiresAt"
        END
      RETURNING "count"
    `;
    const count = rows[0]?.count;
    if (count === undefined) throw new Error('Rate-limit increment failed');
    return count;
  }

  async clear(): Promise<void> {
    await this.prisma.authRateLimitBucket.deleteMany();
  }
}
