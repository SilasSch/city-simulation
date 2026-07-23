import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/server',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'server',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    // Integrationstests laufen gegen eine echte, isolierte Testdatenbank
    // (siehe test/global-setup.ts). Argon2-Hashing braucht etwas Zeit.
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 15000,
    hookTimeout: 60000,
    env: {
      DATABASE_URL:
        'postgresql://city:city@localhost:5432/city_simulation_test',
    },
    // Alle Server-Tests teilen eine Datenbank und räumen sie zwischen den
    // Tests auf — parallele Dateien würden sich gegenseitig truncaten.
    fileParallelism: false,
  },
}));
