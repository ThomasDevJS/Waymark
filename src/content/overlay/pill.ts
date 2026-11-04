/**
 * On-page recording pill (SPEC: Recorder, "State"): shows that recording is on and the last
 * recorded step, so authors can follow along without the side panel. Top frame only.
 */
import type { RecordingView } from '../../core/recorder/session';
import { renderInline } from '../../core/text/markdown';
import { overlayLayer, overlayRoot } from './host';

const CSS = `
.pill { position: fixed; left: 16px; bottom: 16px; max-width: min(420px, calc(100vw - 32px)); display: flex; gap: 8px; align-items: center;
  padding: 6px 12px; border-radius: 999px; background: #1d1f23; color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.3); pointer-events: none; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: #e53935; flex: none; }
.paused .dot { background: #9e9e9e; }
.label { font-weight: 600; flex: none; }
.last { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (prefers-color-scheme: light) { .pill { background: #fff; color: #1d1f23; border: 1px solid #d9dde3; } }
@media (prefers-reduced-motion: no-preference) { .dot { animation: blink 1.5s ease-in-out infinite; } .paused .dot { animation: none; } }
@keyframes blink { 50% { opacity: .35; } }
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
  const last = document.createElement('span');
  last.className = 'last';
  last.append(...(view.lastStepTitle ? renderInline(view.lastStepTitle) : [document.createTextNode(`${view.count} steps`)]));
  pill.replaceChildren(dot, label, last);
}

/** Shows a short notice in the pill for a few seconds, then the last step again. */
export function flashPill(text: string): void {
  if (window !== window.top || !pill?.isConnected || !lastView) return;
  const view = lastView;
  const last = pill.querySelector('.last');
  if (!last) return;
  last.textContent = text;
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
