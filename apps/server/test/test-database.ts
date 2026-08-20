import type { PrismaService } from '../src/persistence/prisma.service';

/**
 * Setzt die Testdatenbank zwischen Tests zurück. CASCADE deckt alle
 * FK-abhängigen Tabellen ab — neue Tabellen müssen hier nicht zwingend
 * einzeln aufgeführt werden, wenn sie per Cascade an "User" hängen.
 */
export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuthRateLimitBucket", "Character", "Session", "PlayerProfile", "User" RESTART IDENTITY CASCADE',
  );
}
