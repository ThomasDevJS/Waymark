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

export function showPill(view: RecordingView): void {
  if (window !== window.top) return;
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

export function hidePill(): void {
  pill?.remove();
  pill = null;
}
