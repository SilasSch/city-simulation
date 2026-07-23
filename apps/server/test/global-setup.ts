import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Vitest Global Setup: bereitet eine isolierte PostgreSQL-Testdatenbank vor.
 * Läuft einmal pro Testlauf (lokal wie in der CI):
 * 1. Datenbank `city_simulation_test` anlegen, falls sie fehlt
 * 2. Prisma-Migrationen dagegen anwenden (echte Migrationen, kein db push)
 */

export const TEST_DATABASE_URL =
  'postgresql://city:city@localhost:5432/city_simulation_test';

const ADMIN_DATABASE_URL = 'postgresql://city:city@localhost:5432/postgres';

export default async function globalSetup(): Promise<void> {
  const admin = new PrismaClient({
    datasources: { db: { url: ADMIN_DATABASE_URL } },
  });
  try {
    // CREATE DATABASE kennt kein IF NOT EXISTS — Duplikat ist kein Fehler.
    await admin.$executeRawUnsafe('CREATE DATABASE city_simulation_test');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('already exists')) throw error;
  } finally {
    await admin.$disconnect();
  }

  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'deploy',
      '--schema',
      join(__dirname, '..', 'prisma', 'schema.prisma'),
    ],
    {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'inherit',
    },
  );
}
