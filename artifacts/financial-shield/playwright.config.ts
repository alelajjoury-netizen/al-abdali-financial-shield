import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Replit provides Chromium with its system dependencies. Elsewhere use the
// browser installed with `pnpm exec playwright install chromium`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined);

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: 'list',
  outputDir: '../../generated-artifacts/financial-shield-ui',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    launchOptions: { executablePath },
    trace: 'retain-on-failure',
  },
  // A test-only frontend, not a backend: every /api request is intercepted.
  webServer: {
    command: 'PORT=4173 BASE_PATH=/ pnpm exec vite --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
