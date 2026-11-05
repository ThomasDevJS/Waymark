/**
 * The Practice page (D128) in a real browser: every element a tutorial points at is on the page
 * and the real matcher finds it from its fingerprint; the panel's Tutorials section opens it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { userEvent } from 'vitest/browser';
import { Practice, VIEW_OF } from '../../src/entrypoints/practice/Practice';
import { Tutorials, tutorialsHidden } from '../../src/entrypoints/sidepanel/Tutorials';
import { TUTORIALS } from '../../src/core/tutorials/tutorials';
import { buildFingerprint } from '../../src/core/fingerprint/build';
import { matchOnce } from '../../src/core/matcher';
import { destroyOverlay } from '../../src/content/overlay/host';

let sent: { type: string; payload: unknown }[];
let root: HTMLElement;
beforeEach(() => {
  sent = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: async (m: { type: string; payload: unknown }) => {
        sent.push(m);
        return { ok: true, data: m.type === 'voice.settings.get' ? { muted: true } : { ok: true } };
      },
      getURL: (p: string) => `chrome-extension://x/${p}`,
    },
    tabs: { create: async (o: unknown) => sent.push({ type: 'tabs.create', payload: o }) },
    storage: { local: { get: async () => ({}), set: async () => undefined } },
  };
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  destroyOverlay();
});
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('practice page targets', () => {
  it('every tutorial target exists (but the not-found demo), and the matcher finds it uniquely', async () => {
    render(h(Practice, null), root);
    await tick();
    const targets = new Set(TUTORIALS.flatMap((t) => t.steps.map((s) => s.target).filter((x): x is string => !!x)));
    for (const id of targets) {
      if (id === 'practice-missing') continue;
      // Show the view the element lives in, as the tutorial would have.
      const v = VIEW_OF[id];
      if (v) root.querySelector<HTMLElement>(`[data-guide-id="practice-nav-${v}"]`)!.click();
      await tick(20);
      const el = document.querySelector(`[data-guide-id="${id}"]`);
      expect(el, id).not.toBeNull();
      const r = matchOnce(document, buildFingerprint(el!));
      expect(r.status, id).toBe('found');
      if (r.status === 'found') expect(r.element, id).toBe(el);
    }
    expect(document.querySelector('[data-guide-id="practice-missing"]')).toBeNull();
  });

  it('says it is practice, and starting a tutorial plays its first step on the page', async () => {
    render(h(Practice, null), root);
    await tick();
    expect(root.textContent).toContain('Nothing here is real');
    // Plainly a tutorial page: no made-up company or brand names (D89).
    expect(root.querySelector('h1')!.textContent).toContain('Tutorial page');
    expect(root.querySelector('h1')!.textContent).not.toContain('Practice');
    root.querySelector<HTMLElement>('[data-guide-id="practice-nav-invoices"]')!.click();
    await tick(20);
    expect(root.textContent).toContain('Sample customer A');
    for (const name of ['Northwind', 'Bakery', 'Lovelace', 'Babbage']) expect(root.textContent, name).not.toContain(name);
    root.querySelector<HTMLElement>('[data-guide-id="practice-nav-dashboard"]')!.click();
    await tick(20);
    await userEvent.click(root.querySelector<HTMLElement>('[data-testid="practice-start-tour"]')!);
    await tick(150);
    const tip = document.querySelector('waymark-overlay');
    expect(tip).not.toBeNull();
    expect(sent.some((m) => m.type === 'tutorial.speak')).toBe(true);
    expect(root.textContent).toContain('Playing “How Waymark works”');
    await userEvent.click(root.querySelector<HTMLElement>('[data-testid="practice-stop"]')!);
    expect(sent.some((m) => m.type === 'tutorial.stop')).toBe(true);
  });
});

describe('panel Tutorials section', () => {
  it('lists the tutorials as Built-in; Start opens the practice page; no copy without an allowed site', async () => {
    tutorialsHidden.value = false;
    render(h(Tutorials, { tabUrl: null }), root);
    await tick();
    expect(root.textContent).toContain('Built-in');
    expect(root.querySelectorAll('[data-testid^="tutorial-start-"]')).toHaveLength(TUTORIALS.length);
    await userEvent.click(root.querySelector<HTMLElement>('[data-testid="tutorial-start-edit"]')!);
    expect(sent.find((m) => m.type === 'tabs.create')!.payload).toEqual({ url: 'chrome-extension://x/practice.html?tutorial=edit' });
    await userEvent.click(root.querySelector<HTMLElement>('[data-testid="tutorial-more-edit"]')!);
    expect(root.querySelector('[data-testid="tutorial-copy-edit"]')).toBeNull();
  });
});
