import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

const baseURL = 'http://localhost:4200';

export default defineConfig({
  testDir: './src',
  outputDir: '../../output/playwright/test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    [process.env['CI'] ? 'line' : 'list'],
    [
      'html',
      {
        outputFolder: '../../output/playwright/report',
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      name: 'server-e2e',
      command: `${JSON.stringify(process.execPath)} apps/client-e2e/scripts/start-e2e-server.mjs`,
      cwd: workspaceRoot,
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      name: 'client',
      command: 'pnpm exec nx serve client',
      cwd: workspaceRoot,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
