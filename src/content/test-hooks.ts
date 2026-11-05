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

let spotted: Element | null = null;
/**
 * Marks the element the player spotlights with `data-waymark-test-spot` (test builds only), so
 * end-to-end harnesses can check a step was drawn on the right element. The fingerprint never
 * reads this attribute.
 */
export function testSpot(el: Element | null, step?: number): void {
  if (!__WAYMARK_TEST__) return;
  if (spotted && spotted !== el) spotted.removeAttribute('data-waymark-test-spot');
  spotted = el;
  el?.setAttribute('data-waymark-test-spot', String(step ?? ''));
}
