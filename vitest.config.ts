import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

const define = { __WAYMARK_TEST__: 'true' };

export default defineConfig({
  define,
  test: {
    projects: [
      {
        define,
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        define,
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.ts'],
          testTimeout: 30_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 1280, height: 900 },
          },
        },
      },
    ],
  },
});
