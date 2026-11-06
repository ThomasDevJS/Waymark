/**
 * While recording, an outline on what a click here would record (D153): the element, or the card
 * of D82 it would be promoted to. Orange and dashed when it would be "hard to find" (D82), red when
 * it would not be recorded at all (D47). Drawn in the overlay with pointer-events off, so it is
 * never part of a click, never over Waymark's own UI, and never in recorded data. One measure per
 * animation frame; the choice is memoized on the hovered element and made only once the pointer
 * rests on a new element (it builds fingerprints, which scan the page for look-alikes).
 */
import { buildFingerprint } from '../core/fingerprint';
import { previewClick, type ClickPreview } from '../core/recorder/preview';
import { eventPath, isOverlayPath, overlayLayer, overlayRoot } from './overlay/host';
import { testMark } from './test-hooks';

/** How long the pointer rests on a new element before its choice is made (review of D153). */
export const REST_MS = 60;

export const REC_HOVER_LABEL: Record<'warn' | 'skip', string> = {
  warn: 'Hard to find',
  skip: 'Won’t be recorded',
};

const CSS = `
.rec-box { position: fixed; z-index: 3; pointer-events: none; box-sizing: border-box; border-radius: 6px; display: none;
  border: 2px solid var(--wm-ring); background: color-mix(in srgb, var(--wm-ring) 8%, transparent); box-shadow: 0 0 0 2px rgba(255,255,255,.8); }
.rec-box[data-tone='warn'] { border: 2px dashed #e8710a; background: rgba(232,113,10,.10); }
.rec-box[data-tone='skip'] { border: 2px dashed var(--wm-danger); background: color-mix(in srgb, var(--wm-danger) 10%, transparent); }
.rec-box > span { position: absolute; left: -2px; bottom: 100%; margin-bottom: 4px; white-space: nowrap; padding: 1px 6px; border-radius: 4px;
  font: 600 11px/16px var(--wm-font); color: #fff; background: #b45309; }
.rec-box[data-tone='skip'] > span { background: var(--wm-danger); }
.rec-box[data-tone='ok'] > span { display: none; }
@media (forced-colors: active) { .rec-box { border-color: Highlight; } }
`;

export function createRecHover(framePath: () => string[]): { start(): void; stop(): void } {
  let on = false;
  let box: HTMLElement | null = null;
  let label: HTMLElement | null = null;
  let frame = 0;
  let rest: ReturnType<typeof setTimeout> | undefined;
  let path: EventTarget[] | null = null;
  let lastPath: EventTarget[] | null = null;
  let memo: { from: Element; preview: ClickPreview | null } | null = null;
  let shown: ClickPreview | null = null;
  let style: HTMLStyleElement | null = null;

  const fpOf = (el: Element) => buildFingerprint(el, { framePath: framePath() });

  const hide = () => {
    shown = null;
    if (box) box.style.display = 'none';
    testMark('rec-hover', 'none');
  };

  // The page may drop or rebuild Waymark's overlay host: put the outline back in the current one.
  const attach = () => {
    if (!box) return;
    const root = overlayRoot();
    if (!style || !style.isConnected) {
      style = root.querySelector<HTMLStyleElement>('style[data-rec-hover]');
      if (!style) {
        style = document.createElement('style');
        style.dataset.recHover = '';
        style.textContent = CSS;
        root.append(style);
      }
    }
    if (!box.isConnected) overlayLayer().append(box);
  };

  const draw = () => {
    frame = 0;
    if (!on || !box || !label) return;
    attach();
    if (path) {
      const p = path;
      path = null;
      const first = p.find((t): t is Element => t instanceof Element) ?? null;
      if (!first || isOverlayPath(p)) {
        clearTimeout(rest);
        return hide();
      }
      if (memo?.from !== first) {
        // A new element: decide once the pointer rests on it, not for every element it crosses.
        hide();
        clearTimeout(rest);
        rest = setTimeout(() => {
          if (!on) return;
          memo = { from: first, preview: previewClick(p, fpOf) };
          shown = memo.preview;
          schedule();
        }, REST_MS);
        return;
      }
      shown = memo.preview;
    }
    if (!shown || !shown.element.isConnected) return hide();
    const r = shown.element.getBoundingClientRect();
    if (!r.width && !r.height) return hide();
    box.dataset.tone = shown.tone;
    label.textContent = shown.tone === 'ok' ? '' : REC_HOVER_LABEL[shown.tone];
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, display: 'block' });
    testMark('rec-hover', shown.tone);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const onMove = (e: Event) => {
    path = lastPath = eventPath(e);
    schedule();
  };
  // The page scrolled or changed size under a still pointer: follow the element.
  const onScroll = () => {
    if (shown) schedule();
  };
  const onOut = (e: PointerEvent) => {
    if (!e.relatedTarget) hide(); // left the window
  };
  // A click can rebuild the page or change what is alike on it: decide again where the pointer is.
  const onDown = () => {
    memo = null;
    hide();
    if (lastPath) {
      path = lastPath;
      schedule();
    }
  };

  return {
    start() {
      if (on) return;
      on = true;
      box = document.createElement('div');
      box.className = 'rec-box';
      box.setAttribute('aria-hidden', 'true');
      label = document.createElement('span');
      box.append(label);
      attach();
      window.addEventListener('pointermove', onMove, { capture: true, passive: true });
      window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      document.addEventListener('pointerout', onOut, { capture: true, passive: true });
      testMark('rec-hover', 'none');
    },
    stop() {
      if (!on) return;
      on = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(rest);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('pointerout', onOut, true);
      box?.remove();
      box = label = null;
      path = lastPath = memo = shown = null;
      testMark('rec-hover', 'off');
    },
  };
}
