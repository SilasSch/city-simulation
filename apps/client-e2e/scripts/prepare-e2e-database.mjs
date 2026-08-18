import process from 'node:process';

import { PrismaClient } from '@prisma/client';

const E2E_DATABASE_NAME = 'city_simulation_e2e';
const DEFAULT_E2E_DATABASE_URL =
  'postgresql://city:city@localhost:5432/city_simulation_e2e';

const operation = process.argv[2];
const databaseUrl = process.env['E2E_DATABASE_URL'] ?? DEFAULT_E2E_DATABASE_URL;
const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.slice(1));

if (databaseName !== E2E_DATABASE_NAME) {
  throw new Error(
    `Refusing to prepare non-E2E database "${databaseName}"; expected "${E2E_DATABASE_NAME}"`,
  );
}

if (operation === 'create') {
  const adminDatabaseUrl = new URL(databaseUrl);
  adminDatabaseUrl.pathname = '/postgres';
  const admin = new PrismaClient({
    datasources: { db: { url: adminDatabaseUrl.toString() } },
  });

  try {
    const existing = await admin.$queryRawUnsafe(
      'SELECT datname FROM pg_database WHERE datname = $1',
      E2E_DATABASE_NAME,
    );
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${E2E_DATABASE_NAME}"`);
    }
  } finally {
    await admin.$disconnect();
  }
} else if (operation === 'truncate') {
  const e2eDatabase = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    await e2eDatabase.$executeRawUnsafe(
      'TRUNCATE TABLE "Character", "Session", "PlayerProfile", "User" RESTART IDENTITY CASCADE',
    );
  } finally {
    await e2eDatabase.$disconnect();
  }
} else {
  throw new Error(
    `Unsupported E2E database operation: ${operation ?? '<none>'}`,
  );
}
