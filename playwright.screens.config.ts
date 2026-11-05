import { defineConfig } from '@playwright/test';

// Screenshots of every screen (D90): `pnpm screens`, headed under Xvfb. Not run in CI.
export default defineConfig({
  testDir: 'test/screens',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
  use: { actionTimeout: 10_000 },
});
