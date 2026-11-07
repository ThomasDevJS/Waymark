import { defineConfig } from '@playwright/test';

// README screenshots (D230): `pnpm shots:readme`, headed under Xvfb. Not run in CI.
export default defineConfig({
  testDir: 'test/shots',
  timeout: 240_000,
  workers: 1,
  reporter: 'list',
  use: { actionTimeout: 10_000 },
});
