import { defineConfig } from '@playwright/test';

// Opt-in real-site harness (`pnpm test:real`): needs network and a headed browser under Xvfb,
// because each site is granted through Chrome's native permission dialog. Not part of CI.
export default defineConfig({
  testDir: '.',
  testMatch: '*.real.ts',
  timeout: 300_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  // Shorter than the harness's 20 s action limit, so errors carry Playwright's call log.
  use: { actionTimeout: 15_000 },
  outputDir: '../../test-results/real-artifacts',
});
