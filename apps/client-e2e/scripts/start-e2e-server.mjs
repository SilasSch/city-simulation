import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';

const E2E_DATABASE_NAME = 'city_simulation_e2e';
const DEFAULT_E2E_DATABASE_URL =
  'postgresql://city:city@localhost:5432/city_simulation_e2e';
const SCHEMA_PATH = 'apps/server/prisma/schema.prisma';

const databaseUrl = process.env['E2E_DATABASE_URL'] ?? DEFAULT_E2E_DATABASE_URL;
const parsedDatabaseUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.slice(1));

if (databaseName !== E2E_DATABASE_NAME) {
  throw new Error(
    `Refusing to prepare non-E2E database "${databaseName}"; expected "${E2E_DATABASE_NAME}"`,
  );
}

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const databaseSetupScript = join(
  process.cwd(),
  'apps',
  'client-e2e',
  'scripts',
  'prepare-e2e-database.mjs',
);
const nxCli = join(
  dirname(require.resolve('nx/package.json')),
  'dist',
  'bin',
  'nx.js',
);

execFileSync(
  process.execPath,
  [prismaCli, 'generate', '--schema', SCHEMA_PATH],
  {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  },
);

execFileSync(process.execPath, [databaseSetupScript, 'create'], {
  env: { ...process.env, E2E_DATABASE_URL: databaseUrl },
  stdio: 'inherit',
});

execFileSync(
  process.execPath,
  [prismaCli, 'migrate', 'deploy', '--schema', SCHEMA_PATH],
  {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  },
);

execFileSync(process.execPath, [databaseSetupScript, 'truncate'], {
  env: { ...process.env, E2E_DATABASE_URL: databaseUrl },
  stdio: 'inherit',
});

const server = spawn(process.execPath, [nxCli, 'serve', 'server'], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    SERVER_PORT: '3000',
    CLIENT_ORIGIN: 'http://localhost:4200',
    SESSION_COOKIE_SECURE: 'false',
  },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (!server.killed) server.kill(signal);
  });
}

server.once('error', (error) => {
  console.error('Failed to start the E2E server', error);
  process.exit(1);
});

server.once('exit', (code) => {
  process.exit(code ?? 1);
});
