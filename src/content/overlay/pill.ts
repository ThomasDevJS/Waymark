/**
 * On-page recording pill (SPEC: Recorder, "State"): shows that recording is on and the last
 * recorded step, so authors can follow along without the side panel. Top frame only.
 */
import type { RecordingView } from '../../core/recorder/session';
import { renderInline } from '../../core/text/markdown';
import { overlayLayer, overlayRoot } from './host';

const CSS = `
.pill { position: fixed; left: 16px; bottom: 16px; max-width: min(440px, calc(100vw - 32px)); display: flex; gap: 8px; align-items: center; box-sizing: border-box;
  padding: 6px 14px 6px 10px; border-radius: 999px; background: var(--wm-surface); color: var(--wm-fg); border: 1px solid var(--wm-border);
  box-shadow: var(--wm-shadow-2); pointer-events: none; font: 13px/1.4 var(--wm-font); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--wm-rec); flex: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--wm-rec) 25%, transparent); }
.paused .dot { background: var(--wm-fg-muted); box-shadow: none; }
.label { font-weight: 700; flex: none; letter-spacing: .04em; font-size: 12px; color: var(--wm-rec); }
.paused .label { color: var(--wm-fg-muted); }
.sep { width: 1px; align-self: stretch; background: var(--wm-border); flex: none; }
.last { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.pill.notice .last { color: var(--wm-warn); font-weight: 500; }
@media (prefers-reduced-motion: no-preference) {
  .pill { animation: wm-pill-in 180ms var(--wm-ease); }
  .dot { animation: wm-blink 1.5s ease-in-out infinite; }
  .paused .dot { animation: none; }
}
@keyframes wm-blink { 50% { opacity: .35; } }
@keyframes wm-pill-in { from { opacity: 0; translate: 0 6px; } }
@media (forced-colors: active) { .pill { border: 1px solid CanvasText; } .dot { background: Mark; } }
`;

let pill: HTMLElement | null = null;
let lastView: RecordingView | null = null;
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** How long a notice replaces the last step in the pill. */
export const FLASH_MS = 4000;

export function showPill(view: RecordingView): void {
  if (window !== window.top) return;
  lastView = view;
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
  if (!view.active) {
    pill?.remove();
    pill = null;
    return;
  }
  if (!pill || !pill.isConnected) {
    const root = overlayRoot();
    if (!root.querySelector('style[data-pill]')) {
      const style = document.createElement('style');
      style.dataset.pill = '';
      style.textContent = CSS;
      root.append(style);
    }
    pill = document.createElement('div');
    pill.className = 'pill';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    overlayLayer().append(pill);
  }
  pill.classList.toggle('paused', view.paused);
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = view.paused ? 'Paused' : 'REC';
  const sep = document.createElement('span');
  sep.className = 'sep';
  const last = document.createElement('span');
  last.className = 'last';
  if (view.lastStepTitle) last.append(document.createTextNode(`${view.count}. `), ...renderInline(view.lastStepTitle));
  else last.textContent = view.count ? `${view.count} steps` : 'Use the page; each action becomes a step';
  pill.classList.remove('notice');
  pill.replaceChildren(dot, label, sep, last);
}

/** Shows a short notice in the pill for a few seconds, then the last step again. */
export function flashPill(text: string): void {
  if (window !== window.top || !pill?.isConnected || !lastView) return;
  const view = lastView;
  const last = pill.querySelector('.last');
  if (!last) return;
  last.textContent = text;
  pill.classList.add('notice');
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashTimer = null;
    if (pill?.isConnected) showPill(view);
  }, FLASH_MS);
}

export function hidePill(): void {
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
  lastView = null;
  pill?.remove();
  pill = null;
}
