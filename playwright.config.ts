import { defineConfig } from '@playwright/test';

// E2E tests load the test build (.output-test) into Chromium with a persistent context.
// Grant tests need a headed browser (run under xvfb-run on Linux): see test/e2e/fixtures.ts.
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  workers: 1,
  // Test-level sharding in CI (D51). One worker, so tests still run one at a time, in file order.
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
});
