import { defineConfig } from '@playwright/test';

// Motion frame-time bench (D130): `pnpm motion:bench`, headed under Xvfb. Not run in CI
// (timings on shared runners are noisy); results go to artifacts/motion/.
export default defineConfig({
  testDir: 'test/bench',
  testMatch: '**/*.bench.ts',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
});
