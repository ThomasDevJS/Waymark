/** Small helpers for browser tests that render hand-written markup (test-only constants). */
import { beforeEach } from 'vitest';
import { buildFingerprint } from '../../src/core/fingerprint';
import { matchOnce } from '../../src/core/matcher';

const ROOT_ID = 'mk-root';

export const host = () => document.getElementById(ROOT_ID)!;

/** Gives every test an empty root at the top of the page. */
export function useRoot(): void {
  beforeEach(() => {
    const el = document.createElement('div');
    el.id = ROOT_ID;
    document.body.replaceChildren(el);
    window.scrollTo(0, 0);
  });
}

export function html(markup: string, into: Element | ShadowRoot = host()): void {
  const t = document.createElement('template');
  t.innerHTML = markup; // eslint-disable-line no-restricted-properties
  into.replaceChildren(t.content);
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector<T>(sel)!;

/** Records `el`, replays on the same (unchanged) page, and returns the fingerprint and the match. */
export function recordAndReplay(el: Element) {
  const fp = buildFingerprint(el);
  return { fp, r: matchOnce(document, fp) };
}
