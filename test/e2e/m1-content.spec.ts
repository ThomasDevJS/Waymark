/** M1 acceptance (browser parts): Navigation API in the content script; frame nonce mapping. */
import { canGrant, expect, marker, test } from './fixtures';

test.skip(!canGrant, 'needs a headed browser under X (xvfb-run) to accept the permission dialog');

interface NavEntry {
  via: string;
  navigationType: string | null;
  url: string;
}

test('Navigation API events reach the content script isolated world', async ({ context, ext, site }) => {
  await ext.grant('http://127.0.0.1/*');
  const page = await context.newPage();
  await page.goto(`${site.main}/?static`);
  await expect.poll(() => marker(page, 'loaded')).toBe('yes');
  const log = async (): Promise<NavEntry[]> => JSON.parse((await marker(page, 'nav')) ?? '[]');
  const viaFor = async (path: string) => (await log()).filter((e) => new URL(e.url).pathname + new URL(e.url).search + new URL(e.url).hash === path);

  await page.click('#push-route');
  await expect.poll(async () => (await viaFor('/app/orders/77')).map((e) => e.via)).toContain('navigation-api');
  await page.click('#replace-route');
  await expect.poll(async () => (await viaFor('/app/orders/78')).map((e) => e.via)).toContain('navigation-api');
  await page.click('#hash-route');
  await expect.poll(async () => (await viaFor('/app/orders/78#/inbox/3')).map((e) => e.via)).toContain('navigation-api');
  await page.click('#query-route');
  await expect.poll(async () => (await viaFor('/app/orders/78?page=2')).map((e) => e.via)).toContain('navigation-api');
  await page.goBack();
  await expect.poll(async () => (await viaFor('/app/orders/78#/inbox/3')).length).toBeGreaterThan(1);

  const entries = await log();
  const types = entries.filter((e) => e.via === 'navigation-api').map((e) => e.navigationType);
  console.log('Navigation API events seen by the content script:', JSON.stringify(entries));
  expect(types).toEqual(expect.arrayContaining(['push', 'replace', 'traverse']));
  // The route reports reach the service worker (top frame).
  const sw = await ext.sw();
  await expect.poll(() => sw.evaluate(async () => Object.entries(await chrome.storage.session.get(null)).find(([k]) => k.startsWith('test:route:'))?.[1])).toContain('/app/orders/78');
});

test('frame nonce mapping gives same-origin, cross-origin and srcdoc frames their framePath', async ({ context, ext, site }) => {
  await ext.grant('http://127.0.0.1/*');
  await ext.grant('http://localhost/*');
  const page = await context.newPage();
  await page.goto(`${site.main}/?static`);
  await expect.poll(() => marker(page, 'frame-path')).toBe('[]');

  const same = page.frames().find((f) => f.url().startsWith(`${site.main}/frame.html`))!;
  const cross = page.frames().find((f) => f.url().startsWith(`${site.other}/frame.html`))!;
  const nested = cross.childFrames()[0]!;
  expect(nested.url()).toBe('about:srcdoc');

  const pathOf = async (f: import('@playwright/test').Frame): Promise<string[] | null> => {
    const v = await marker(f, 'frame-path');
    return v ? JSON.parse(v) : null;
  };
  await expect.poll(() => pathOf(same), { timeout: 10_000 }).toHaveLength(1);
  await expect.poll(() => pathOf(cross), { timeout: 10_000 }).toHaveLength(1);
  await expect.poll(() => pathOf(nested), { timeout: 10_000 }).toHaveLength(2);

  // Each selector resolves, from its parent document, to exactly that iframe.
  const [sameSel] = (await pathOf(same))!;
  const [crossSel] = (await pathOf(cross))!;
  const nestedPath = (await pathOf(nested))!;
  expect(await page.evaluate((s) => document.querySelector(s)?.getAttribute('src'), sameSel!)).toContain('name=same');
  expect(await page.evaluate((s) => document.querySelector(s)?.getAttribute('src'), crossSel!)).toContain('name=cross');
  expect(nestedPath[0]).toBe(crossSel);
  expect(await cross.evaluate((s) => document.querySelector(s)?.getAttribute('title'), nestedPath[1]!)).toBe('Nested srcdoc frame');
});
