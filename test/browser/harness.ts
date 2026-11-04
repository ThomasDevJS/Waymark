import { mountApp, takeKeys, type AppOptions } from '../fixtures/site/app.js';
import { buildFingerprint } from '../../src/core/fingerprint';
import { matchOnce, type MatchResult } from '../../src/core/matcher';
import type { ElementFingerprint } from '../../src/core/model/schema';

export const STYLE = `
  body { margin: 0; font: 14px sans-serif; }
  .app { padding: 8px; } header, nav, .toolbar, .cards, .pager, .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .card { border: 1px solid #ccc; padding: 8px; margin: 8px 0; }
  [role=switch] { display: inline-block; width: 32px; height: 16px; background: #ccc; margin: 4px; }
  [role=combobox] { display: inline-block; padding: 4px; border: 1px solid #999; }
  .portal .listbox { border: 1px solid #999; width: 160px; }
  .option { padding: 2px 4px; }
`;

export function root(): HTMLElement {
  let el = document.getElementById('fx-root');
  if (!el) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    el = document.createElement('div');
    el.id = 'fx-root';
    document.body.append(el);
  }
  return el;
}

/** Renders a version of the fixture app and returns its key map (attributes stripped). */
export function render(opts: AppOptions): Map<string, Element[]> {
  window.scrollTo(0, 0);
  mountApp(root(), opts);
  return takeKeys(document);
}

export function recordAll(opts: AppOptions): Map<string, ElementFingerprint> {
  const keys = render(opts);
  const out = new Map<string, ElementFingerprint>();
  for (const [key, els] of keys) {
    if (key.includes('#')) continue;
    out.set(key, buildFingerprint(els[0]!));
  }
  return out;
}

export interface Outcome {
  key: string;
  result: 'found' | 'wrong' | 'not-found';
  detail: MatchResult;
}

export function replayAll(fps: Map<string, ElementFingerprint>, opts: AppOptions): Outcome[] {
  const keys = render(opts);
  const out: Outcome[] = [];
  for (const [key, fp] of fps) {
    const detail = matchOnce(document, fp);
    const expected = keys.get(key) ?? [];
    let result: Outcome['result'] = 'not-found';
    if (detail.status === 'found') result = expected.includes(detail.element) ? 'found' : 'wrong';
    out.push({ key, result, detail });
  }
  return out;
}

export function summarize(outcomes: Outcome[]) {
  const found = outcomes.filter((o) => o.result === 'found').length;
  const wrong = outcomes.filter((o) => o.result === 'wrong');
  const missing = outcomes.filter((o) => o.result === 'not-found');
  return {
    total: outcomes.length,
    found,
    rate: outcomes.length ? found / outcomes.length : 0,
    wrong: wrong.map((o) => o.key),
    missing: missing.map((o) => `${o.key}(${o.detail.status === 'not-found' ? `${o.detail.reason} ${o.detail.bestScore.toFixed(0)}/${o.detail.runnerUpScore.toFixed(0)}` : ''})`),
  };
}
