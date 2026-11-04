/**
 * Test-build-only hooks. In production builds __WAYMARK_TEST__ is false and these calls are
 * removed, so pages can never see them.
 */
export function testMark(name: string, value: string): void {
  if (!__WAYMARK_TEST__) return;
  document.documentElement?.setAttribute(`data-waymark-test-${name}`, value);
}

const log: unknown[] = [];
export function testLog(name: string, entry: unknown): void {
  if (!__WAYMARK_TEST__) return;
  log.push(entry);
  testMark(name, JSON.stringify(log));
}
