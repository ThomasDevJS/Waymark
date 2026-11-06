/** The how-to preview (D195) in a real browser: per-step Keep / Leave out / Blur / Zoom, old close-ups, missing hints, the saved file. */
import { afterEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { userEvent } from 'vitest/browser';
import { Preview } from '../../src/entrypoints/howto/Preview';
import type { Guide, Step } from '../../src/core/model/schema';
import type { ShotRecord } from '../../src/core/shots/store';

const step = (id: string, title = `Click **${id}**`): Step => ({
  id,
  kind: 'click',
  title,
  url: { kind: 'pattern', value: '/' },
  advance: 'action',
  target: { instance: 'unique', matchCount: 1, tag: 'button', cssPath: `#${id}`, xpath: '/x', ancestors: [], shadowPath: [], framePath: [], rect: { x: 1, y: 2, w: 3, h: 4, vw: 100, vh: 100 } },
});

const guide = (steps: Step[], title = 'Export orders'): Guide => ({
  id: 'g1',
  schemaVersion: 1,
  revisionId: 'r1',
  title,
  lang: 'en',
  tags: [],
  appOrigins: ['https://app.example'],
  startUrl: 'https://app.example/orders',
  matchUrls: [],
  steps,
  version: 1,
  source: 'local',
  updatedAt: '2026-11-06T00:00:00Z',
});

/** A page-like image: text stripes everywhere, a blue element at the box. */
async function pageShot(stepId: string, v: number | null = 2, w = 800, hgt = 450): Promise<ShotRecord> {
  const c = new OffscreenCanvas(w, hgt);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, hgt);
  ctx.fillStyle = '#000';
  for (let y = 10; y < hgt; y += 6) for (let x = 0; x < w; x += 4) ctx.fillRect(x, y, 2, 2);
  ctx.fillStyle = '#0000ff';
  const box = { x: 400, y: 200, w: 60, h: 30 };
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.9 });
  return { key: `g1/${stepId}`, guideId: 'g1', stepId, ...(v ? { v } : {}), blob, w, h: hgt, box, px: 1, t: 'x', at: 0 };
}

let root: HTMLElement | null = null;
afterEach(() => {
  if (root) render(null, root);
  root?.remove();
  root = null;
});

const q = (id: string) => root!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const img = (n: number) => root!.querySelector<HTMLImageElement>(`[data-testid="howto-img-${n}"]`);

async function ready() {
  await expect.poll(() => q('howto-preview')?.dataset.ready, { timeout: 5000 }).toBe('yes');
}

/**
 * Image n's size once it is decoded: the preview is "ready" when its drawings exist, but an
 * <img> whose src just changed has no size until it decodes. Reading naturalWidth before that
 * gave 0 now and then under load (flaky until D158).
 */
async function decodedWidth(n: number): Promise<number> {
  const el = img(n)!;
  await el.decode();
  return el.naturalWidth;
}

/** Contrast between neighbouring pixels in the context (far from the element): high when sharp. */
async function contextContrast(el: HTMLImageElement): Promise<number> {
  await el.decode();
  const c = new OffscreenCanvas(el.naturalWidth, el.naturalHeight);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(el, 0, 0);
  const d = ctx.getImageData(20, 40, 40, 12).data;
  let max = 0;
  let min = 255;
  for (let i = 0; i < d.length; i += 4) {
    max = Math.max(max, d[i]!);
    min = Math.min(min, d[i]!);
  }
  return max - min;
}

async function mount(opts: { steps?: Step[]; shots?: ShotRecord[]; on?: boolean; title?: string } = {}) {
  const steps = opts.steps ?? [step('a'), step('b'), step('c')];
  const shots = opts.shots ?? [await pageShot('a'), await pageShot('b')];
  const saved: { name: string; html: string }[] = [];
  let printed = 0;
  root = document.createElement('div');
  document.body.append(root);
  render(
    h(Preview, {
      guides: [guide(steps, opts.title)],
      shots,
      shotsOn: new Set(opts.on === false ? [] : ['g1']),
      name: 'My guide',
      date: '6 November 2026',
      onDownload: (name: string, html: string) => saved.push({ name, html }),
      onPrint: () => void printed++,
    }),
    root,
  );
  await ready();
  return { saved, printed: () => printed };
}

describe('how-to preview (D195)', () => {
  it('shows every step with its screenshot, sharp and whole by default, and hints where one is missing', async () => {
    await mount();
    expect(img(1)).not.toBeNull();
    expect(img(2)).not.toBeNull();
    expect(img(3)).toBeNull();
    expect(q('howto-missing-3')!.textContent).toContain('Alt+W');
    expect(q('howto-blurstep-1')).not.toHaveProperty('checked', true);
    expect((q('howto-zoom-1') as HTMLInputElement).checked).toBe(false);
    await img(1)!.decode();
    expect(await decodedWidth(1)).toBe(800);
    expect(await contextContrast(img(1)!)).toBeGreaterThan(150);
    expect(q('howto-summary')!.textContent).toContain('2 screenshots');
    expect(root!.textContent).toContain('3 steps · 6 November 2026');
  });

  it('Leave out takes the image out of the page and the file; Keep brings it back', async () => {
    const { saved } = await mount();
    await userEvent.click(q('howto-keep-2')!);
    await ready();
    expect(img(2)).toBeNull();
    expect(q('howto-step-2')!.textContent).toContain('Left out');
    expect(q('howto-summary')!.textContent).toContain('1 left out');
    await userEvent.click(q('howto-download')!);
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]!.name).toBe('My-guide.html');
    expect(saved[0]!.html.match(/<img src="data:image\/webp;base64,/g)).toHaveLength(1);
    await userEvent.click(q('howto-keep-2')!);
    await ready();
    expect(img(2)).not.toBeNull();
  });

  it('Blur smears the context of that image only; the element stays sharp', async () => {
    await mount();
    await userEvent.click(q('howto-blurstep-1')!);
    await ready();
    await expect.poll(async () => contextContrast(img(1)!), { timeout: 5000 }).toBeLessThan(60);
    expect(await contextContrast(img(2)!)).toBeGreaterThan(150);
    // The element's own pixels: still pure blue.
    const el = img(1)!;
    await el.decode();
    const c = new OffscreenCanvas(el.naturalWidth, el.naturalHeight);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(el, 0, 0);
    const [r, , b] = ctx.getImageData(430, 215, 1, 1).data;
    expect(b).toBeGreaterThan(200);
    expect(r).toBeLessThan(40);
  });

  it('Blur every screenshot sets them all, and clears them all', async () => {
    await mount();
    await userEvent.click(q('howto-blur-all')!);
    await ready();
    expect((q('howto-blurstep-1') as HTMLInputElement).checked).toBe(true);
    expect((q('howto-blurstep-2') as HTMLInputElement).checked).toBe(true);
    await userEvent.click(q('howto-blur-all')!);
    await ready();
    expect((q('howto-blurstep-2') as HTMLInputElement).checked).toBe(false);
  });

  it('Zoom draws only the part around the element, at render time', async () => {
    const { saved } = await mount();
    await userEvent.click(q('howto-zoom-1')!);
    await ready();
    // The zoomed drawing replaces the first one: wait for it, decoded, not for a time.
    await expect.poll(() => decodedWidth(1), { timeout: 10_000 }).toBeLessThan(800);
    expect(await decodedWidth(1)).toBeGreaterThan(0);
    expect(await decodedWidth(2)).toBe(800);
    await userEvent.click(q('howto-download')!);
    await expect.poll(() => saved.length).toBe(1);
    const widths = [...saved[0]!.html.matchAll(/width="(\d+)"/g)].map((m) => Number(m[1]));
    expect(widths[0]).toBeLessThan(800);
    expect(widths[1]).toBe(800);
  });

  it('links (D159): the start page, and a step whose page changes; the saved file can enlarge its images', async () => {
    const { saved } = await mount({ steps: [{ ...step('a'), url: { kind: 'pattern', value: '/orders' } }, { ...step('b'), url: { kind: 'pattern', value: '/orders/new' } }, step('c')] });
    await ready();
    const start = root!.querySelector<HTMLAnchorElement>('.start a')!;
    expect(start.href).toBe('https://app.example/');
    expect(q('howto-page-1')).toBeNull(); // the start page itself
    expect((q('howto-page-2') as HTMLAnchorElement).href).toBe('https://app.example/orders/new');
    expect((q('howto-page-3') as HTMLAnchorElement).href).toBe('https://app.example/');
    await userEvent.click(q('howto-download')!);
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]!.html).toContain('<a class="page" href="https://app.example/orders/new">Open this page</a>');
    expect(saved[0]!.html.match(/<label class="zoom"/g)).toHaveLength(2);
  });

  it('an old 0.5.0 close-up still renders, is marked, and cannot be zoomed', async () => {
    await mount({ shots: [await pageShot('a', null, 460, 252)] });
    expect(img(1)).not.toBeNull();
    expect(q('howto-old-1')!.textContent).toContain('Capture again');
    expect((q('howto-zoom-1') as HTMLInputElement).disabled).toBe(true);
    expect(q('howto-old-2')).toBeNull();
  });

  it('Save as PDF prints once every image is decoded; the controls are not printed', async () => {
    const { printed } = await mount();
    await userEvent.click(q('howto-print')!);
    await expect.poll(printed).toBe(1);
    for (const el of root!.querySelectorAll('.howto-controls, .howto-bar, [data-testid^="howto-missing"]')) expect(el.classList.contains('no-print')).toBe(true);
  });

  it('the saved file is self-contained and escapes every string', async () => {
    const evil = '<img src=x onerror=alert(1)> see https://evil.example/x';
    const { saved } = await mount({ title: evil, steps: [step('a', evil)], shots: [await pageShot('a')] });
    expect(root!.querySelector('img[src="x"]')).toBeNull();
    await userEvent.click(q('howto-download')!);
    await expect.poll(() => saved.length).toBe(1);
    const html = saved[0]!.html;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('evil.example');
    expect(html).not.toMatch(/<script|<link|src="(?!data:image\/webp;base64,)/);
    expect(html).toContain("default-src 'none'");
  });

  it('a guide with screenshots off shows no missing hints', async () => {
    await mount({ shots: [], on: false });
    expect(q('howto-missing-1')).toBeNull();
    expect(q('howto-summary')!.textContent).toContain('No screenshots');
  });
});
