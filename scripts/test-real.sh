#!/usr/bin/env bash
# pnpm test:real: build the test extension, run the real-site harness under Xvfb, print the
# results table, and exit with Playwright's status (wrong or missing steps fail the run).
set -u
pnpm build:test || exit 1
rm -rf test-results/real
xvfb-run -a playwright test -c test/real/playwright.config.ts "$@"
status=$?
node scripts/real-report.mjs
exit $status
