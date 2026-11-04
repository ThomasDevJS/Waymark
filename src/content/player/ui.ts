/**
 * Player overlay UI (SPEC: Player and overlay): spotlight panels, a Floating UI tooltip and the
 * not-found, off-track and done cards. Everything lives in the overlay host's shadow root and
 * is built with DOM APIs (user strings never reach innerHTML).
 */
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom';
import type { RunView } from '../../core/player/run';
import { spotlightPanels } from '../../core/player/spotlight';
import { renderInline } from '../../core/text/markdown';
import { composedParent } from '../../core/fingerprint/dom';
import { mountOverlayIn, overlayLayer, overlayRoot } from '../overlay/host';

const CSS = `
.panel { position: fixed; background: rgba(15, 18, 24, .45); pointer-events: none; }
.ring { position: fixed; border: 2px solid #4c7dff; border-radius: 6px; pointer-events: none; box-sizing: border-box; }
.tip { position: fixed; top: 0; left: 0; width: max-content; max-width: min(340px, calc(100vw - 16px)); box-sizing: border-box;
  background: #fff; color: #1d1f23; border: 1px solid #d9dde3; border-radius: 10px; padding: 12px 14px; pointer-events: auto;
  box-shadow: 0 6px 24px rgba(0,0,0,.25); font: 14px/1.45 system-ui, sans-serif; }
.tip.centered { left: 50%; top: 24px; transform: translateX(-50%); }
.count { font-size: 12px; color: #5f6672; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.title { font-weight: 500; margin: 4px 0; }
.note { margin: 4px 0 0; color: #3b4048; }
.buttons { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
button { font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 6px; border: 1px solid #c9ced6; background: transparent; color: inherit; cursor: pointer; }
button.primary { background: #2f5fd0; border-color: #2f5fd0; color: #fff; }
button.icon { border: 0; padding: 2px 4px; }
button:focus-visible { outline: 2px solid #4c7dff; outline-offset: 1px; }
a { color: #2f5fd0; }
@media (prefers-color-scheme: dark) {
  .tip { background: #23262c; color: #e8eaed; border-color: #3a3e45; }
  .count, .note { color: #a0a6b0; }
  button { border-color: #4a4f57; }
  a { color: #8ab0ff; }
}
@media (prefers-reduced-motion: no-preference) { .tip { transition: opacity 120ms; } }
`;

export interface UiHandlers {
  next(): void;
  back(): void;
  skip(): void;
  exit(): void;
  retry(): void;
  report(): void;
  goBack(): void;
  mute(muted: boolean): void;
}

export type Card = 'not-found' | 'off-track' | 'done';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The topmost open modal <dialog> in the document, if any: everything outside it is inert. */
export function openModalDialog(doc: Document = document): Element | null {
  let found: Element | null = null;
  for (const d of Array.from(doc.querySelectorAll('dialog[open]'))) {
    try {
      if (d.matches(':modal')) found = d;
    } catch {
      // :modal unsupported: ignore
    }
  }
  return found;
}

/** The open modal <dialog> containing an element, if any (crossing shadow roots). */
export function modalDialogOf(target: Element): Element | null {
  for (let n: Element | null = target; n; n = composedParent(n)) {
    if (n.localName === 'dialog') {
      try {
        if (n.matches(':modal')) return n;
      } catch {
        return (n as HTMLDialogElement).open ? n : null;
      }
    }
  }
  return null;
}

export class PlayerUI {
  private panels: HTMLElement[] = [];
  private ring: HTMLElement | null = null;
  private tip: HTMLElement | null = null;
  private stopAuto: (() => void) | null = null;

  constructor(private readonly h: UiHandlers) {}

  private ensureStyle(): void {
    const root = overlayRoot();
    if (!root.querySelector('style[data-player]')) {
      const style = el('style');
      style.dataset.player = '';
      style.textContent = CSS;
      root.append(style);
    }
  }

  /** Shows the tooltip for the current step, anchored to `target` with a spotlight, or centered when there is none. */
  showStep(view: RunView, target: Element | null, onLost?: () => void): void {
    this.clear();
    this.ensureStyle();
    // Inside an open modal dialog the tooltip must live in the dialog, or it would be inert.
    mountOverlayIn(target ? (modalDialogOf(target) ?? openModalDialog()) : openModalDialog());
    const layer = overlayLayer();
    const step = view.step;
    if (!step) return;

    const tip = this.tooltipShell(view);
    const title = el('div', 'title');
    title.id = 'waymark-step-title';
    title.append(...renderInline(step.title));
    tip.append(title);
    if (step.note) {
      const note = el('div', 'note');
      note.append(...renderInline(step.note));
      tip.append(note);
    }
    const buttons = el('div', 'buttons');
    if (view.stepIndex > 0) buttons.append(this.button('Back', 'back', this.h.back));
    if (step.kind === 'note' || step.kind === 'input' || step.advance === 'next') {
      buttons.append(this.button(view.stepIndex === view.total - 1 ? 'Done' : 'Next', 'next', this.h.next, true));
    }
    if (step.optional) buttons.append(this.button('Skip', 'skip', this.h.skip));
    buttons.append(this.button('Exit', 'exit', this.h.exit));
    tip.append(buttons);
    layer.append(tip);
    this.tip = tip;

    if (!target) {
      tip.classList.add('centered');
      return;
    }
    this.panels = [0, 1, 2, 3].map(() => {
      const p = el('div', 'panel');
      layer.append(p);
      return p;
    });
    this.ring = el('div', 'ring');
    layer.append(this.ring);
    const placement: Placement = step.placement && step.placement !== 'auto' ? step.placement : 'bottom';
    const update = () => {
      if (!target.isConnected) {
        onLost?.();
        return;
      }
      const r = target.getBoundingClientRect();
      const { hole, panels } = spotlightPanels({ x: r.left, y: r.top, w: r.width, h: r.height }, window.innerWidth, window.innerHeight);
      panels.forEach((b, i) => Object.assign(this.panels[i]!.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` }));
      if (this.ring) Object.assign(this.ring.style, { left: `${hole.x}px`, top: `${hole.y}px`, width: `${hole.w}px`, height: `${hole.h}px` });
      void computePosition(target, tip, { strategy: 'fixed', placement, middleware: [offset(12), flip(), shift({ padding: 8 })] }).then(({ x, y }) => {
        Object.assign(tip.style, { left: `${x}px`, top: `${y}px` });
      });
    };
    this.stopAuto = autoUpdate(target, tip, update, { animationFrame: false });
  }

  showCard(kind: Card, view: RunView): void {
    this.clear();
    this.ensureStyle();
    mountOverlayIn(openModalDialog());
    const tip = this.tooltipShell(view);
    tip.classList.add('centered');
    tip.dataset.card = kind;
    const title = el('div', 'title');
    const note = el('div', 'note');
    const buttons = el('div', 'buttons');
    if (kind === 'done') {
      title.textContent = 'Done!';
      note.textContent = `You finished “${view.guideTitle ?? 'this guide'}”.`;
      buttons.append(this.button('Close', 'close', this.h.exit, true));
    } else if (kind === 'not-found') {
      title.textContent = 'Waymark can’t find this step on the page.';
      note.append(...(view.step ? renderInline(view.step.title) : []));
      buttons.append(
        this.button('Retry', 'retry', this.h.retry, true),
        this.button('Skip', 'skip', this.h.skip),
        this.button('Exit', 'exit', this.h.exit),
        this.button('Report broken step', 'report', this.h.report),
      );
    } else {
      title.textContent = 'This step is on another page.';
      note.append(...(view.step ? renderInline(view.step.title) : []));
      buttons.append(this.button('Go back', 'go-back', this.h.goBack, true), this.button('Skip', 'skip', this.h.skip), this.button('Exit', 'exit', this.h.exit));
    }
    tip.append(title, note, buttons);
    overlayLayer().append(tip);
    this.tip = tip;
  }

  /** Small confirmation inside the current tooltip (e.g. after reporting a broken step). */
  flash(message: string): void {
    if (!this.tip) return;
    const note = el('div', 'note', message);
    note.setAttribute('role', 'status');
    this.tip.append(note);
  }

  clear(): void {
    this.stopAuto?.();
    this.stopAuto = null;
    this.panels.forEach((p) => p.remove());
    this.panels = [];
    this.ring?.remove();
    this.ring = null;
    this.tip?.remove();
    this.tip = null;
  }

  get drawn(): boolean {
    return !!this.tip;
  }

  /** The card currently shown, if any. */
  get card(): Card | null {
    return (this.tip?.dataset.card as Card | undefined) ?? null;
  }

  private tooltipShell(view: RunView): HTMLElement {
    const tip = el('div', 'tip');
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-label', `Waymark guide: ${view.guideTitle ?? ''}`);
    tip.setAttribute('aria-live', 'polite');
    // Keep focus in the app's field: clicks on the tooltip never take it.
    tip.addEventListener('mousedown', (e) => e.preventDefault());
    tip.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.h.exit();
      }
    });
    const count = el('div', 'count');
    count.append(el('span', undefined, `Step ${Math.min(view.stepIndex + 1, view.total)} of ${view.total}`));
    // Mute toggle: reflects the global voice setting; the service worker stops speech.
    const mute = this.button(view.muted ? '🔇' : '🔊', 'mute', () => this.h.mute(!view.muted));
    mute.className = 'icon';
    mute.setAttribute('aria-label', 'Mute voice');
    mute.setAttribute('aria-pressed', String(view.muted));
    count.append(mute);
    tip.append(count);
    return tip;
  }

  private button(label: string, action: string, fn: () => void, primary = false): HTMLButtonElement {
    const b = el('button', primary ? 'primary' : undefined, label);
    b.type = 'button';
    b.dataset.action = action;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  }
}
