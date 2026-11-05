/**
 * Player overlay UI (SPEC: Player and overlay): spotlight panels, a Floating UI tooltip and the
 * not-found, off-track and done cards. Everything lives in the overlay host's shadow root and
 * is built with DOM APIs (user strings never reach innerHTML).
 */
import { arrow, autoUpdate, computePosition, flip, offset, shift, size, type Placement } from '@floating-ui/dom';
import { ChevronLeft, ChevronRight, CircleCheck, MapPin, RotateCcw, Speech, TriangleAlert, Volume2, VolumeX, X, type IconNode } from 'lucide';
import { buildSvg } from '../../ui/svg';
import type { RunView } from '../../core/player/run';
import { spotlightPanels } from '../../core/player/spotlight';
import { renderInline } from '../../core/text/markdown';
import { composedParent } from '../../core/fingerprint/dom';
import { claimOverlay, mountOverlayIn, overlayLayer, overlayRoot, releaseOverlay } from '../overlay/host';

const CSS = `
.spot { position: fixed; z-index: 0; border-radius: 8px; pointer-events: none; box-sizing: border-box;
  box-shadow: 0 0 0 9999px var(--wm-scrim); }
.ring { position: fixed; z-index: 1; border-radius: 8px; pointer-events: none; box-sizing: border-box;
  border: 2px solid var(--wm-ring); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .55), 0 0 0 2px rgba(255, 255, 255, .85), 0 0 0 6px color-mix(in srgb, var(--wm-ring) 30%, transparent); }
.tip { position: fixed; z-index: 2; top: 0; left: 0; width: max-content; max-width: min(360px, calc(100vw - 16px));
  box-sizing: border-box; background: var(--wm-surface); color: var(--wm-fg); border: 1px solid var(--wm-border); border-radius: var(--wm-radius-lg);
  pointer-events: auto; box-shadow: var(--wm-shadow-3); font: 14px/1.45 var(--wm-font); text-align: left; }
.tip-body { padding: 14px 16px 12px; max-height: var(--wm-tip-max, calc(100vh - 16px)); overflow: auto; overscroll-behavior: contain; border-radius: inherit; }
.tip.centered { left: 50%; top: 24px; transform: translateX(-50%); }
.tip.centered .tip-body { max-height: calc(100vh - 48px); }
.arrow[hidden] { display: none; }
.tip *, .tip *::before, .tip *::after { box-sizing: border-box; }
.arrow { position: absolute; width: 12px; height: 12px; background: var(--wm-surface); transform: rotate(45deg); pointer-events: none; }
.arrow[data-side='top'] { border-left: 1px solid var(--wm-border); border-top: 1px solid var(--wm-border); }
.arrow[data-side='bottom'] { border-right: 1px solid var(--wm-border); border-bottom: 1px solid var(--wm-border); }
.arrow[data-side='left'] { border-left: 1px solid var(--wm-border); border-bottom: 1px solid var(--wm-border); }
.arrow[data-side='right'] { border-right: 1px solid var(--wm-border); border-top: 1px solid var(--wm-border); }
.head { display: flex; align-items: center; gap: 8px; margin: -4px -8px 0 0; }
.count { flex: 1; font-size: 12px; font-weight: 600; color: var(--wm-fg-muted); font-variant-numeric: tabular-nums; letter-spacing: .02em; }
.progress { height: 3px; border-radius: 999px; background: var(--wm-surface-2); margin: 6px 0 10px; overflow: hidden; }
.progress > span { display: block; height: 100%; background: var(--wm-accent); border-radius: inherit; }
.badge-icon { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; margin: 2px 0 8px;
  background: var(--wm-accent-soft); color: var(--wm-accent-text); }
.badge-icon svg { width: 20px; height: 20px; }
[data-card='done'] .badge-icon { background: var(--wm-success-soft); color: var(--wm-success); }
[data-card='not-found'] .badge-icon { background: var(--wm-warn-soft); color: var(--wm-warn); }
.title { font-size: 15px; font-weight: 600; line-height: 1.4; margin: 0; overflow-wrap: anywhere; }
.title strong { font-weight: 700; }
.note { margin: 6px 0 0; color: var(--wm-fg-muted); font-size: 13.5px; overflow-wrap: anywhere; }
.flash { margin: 10px 0 0; padding: 6px 10px; border-radius: var(--wm-radius-sm); background: var(--wm-success-soft); color: var(--wm-success); font-size: 13px; }
.buttons { display: flex; gap: 6px; margin-top: 14px; flex-wrap: wrap; align-items: center; }
.buttons .spacer { flex: 1; }
.buttons .report { border-color: var(--wm-border-input); }
button { font: inherit; font-size: 13px; font-weight: 500; line-height: 20px; min-height: 32px; padding: 5px 12px; border-radius: var(--wm-radius-sm);
  border: 1px solid var(--wm-border-input); background: var(--wm-surface); color: var(--wm-fg); cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
  margin: 0; text-transform: none; letter-spacing: normal; box-shadow: none; }
button:hover { background: var(--wm-surface-hover); }
button.primary { background: var(--wm-accent); border-color: var(--wm-accent); color: var(--wm-accent-fg); }
button.primary:hover { background: var(--wm-accent-hover); border-color: var(--wm-accent-hover); }
button.ghost { border-color: transparent; background: transparent; }
button.ghost:hover { background: var(--wm-surface-hover); }
button.icon { min-height: 28px; min-width: 28px; padding: 4px; justify-content: center; border-color: transparent; background: transparent; color: var(--wm-fg-muted); }
button.icon:hover { background: var(--wm-surface-hover); color: var(--wm-fg); }
button[aria-disabled='true'] { opacity: .45; cursor: not-allowed; }
button[aria-disabled='true']:hover { background: transparent; color: var(--wm-fg-muted); }
button:focus-visible { outline: 2px solid var(--wm-focus); outline-offset: 2px; }
button svg { width: 16px; height: 16px; flex: none; }
a { color: var(--wm-accent-text); }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: no-preference) {
  .tip { animation: wm-tip-in 160ms var(--wm-ease); }
  .tip.centered { animation-name: wm-card-in; }
  .ring { animation: wm-ring-in 220ms var(--wm-ease), wm-ring-pulse 1.6s ease-in-out 240ms 2; }
  .spot { animation: wm-fade-in 200ms var(--wm-ease); }
}
@keyframes wm-tip-in { from { opacity: 0; translate: 0 4px; } }
@keyframes wm-card-in { from { opacity: 0; translate: 0 -6px; } }
@keyframes wm-fade-in { from { opacity: 0; } }
@keyframes wm-ring-in { from { opacity: 0; } }
@keyframes wm-ring-pulse { 50% { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .55), 0 0 0 2px rgba(255, 255, 255, .85), 0 0 0 10px color-mix(in srgb, var(--wm-ring) 18%, transparent); } }
@media (forced-colors: active) {
  .tip { border: 2px solid CanvasText; }
  .ring { border-color: Highlight; }
  .spot { box-shadow: none; }
  button { border: 1px solid ButtonText; }
}
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
  /** Read the current step aloud again (D106). Without it (Test step's highlight) there is no button. */
  replayVoice?(): void;
  /** Show the current step again: find, scroll to and highlight the element, and read it (D106). */
  repeat?(): void;
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

/** A step title as plain text (markdown rendered, then read back), for the screen reader announcement. */
function plain(text: string): string {
  const span = document.createElement('span');
  span.append(...renderInline(text));
  return span.textContent ?? '';
}

export class PlayerUI {
  private spot: HTMLElement | null = null;
  private ring: HTMLElement | null = null;
  private tip: HTMLElement | null = null;
  private announcer: HTMLElement | null = null;
  /** A keyboard user pressed this tooltip button; it gets focus back when this step is redrawn. */
  private refocus: { action: string; stepToken: string | null } | null = null;
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
    this.ensureAnnouncer();
  }

  /**
   * Step changes are announced from one live region that stays in the layer, so screen readers
   * read each new step (a live region inserted already filled is often skipped).
   */
  private ensureAnnouncer(): HTMLElement {
    if (!this.announcer?.isConnected) {
      this.announcer = el('div', 'sr');
      this.announcer.setAttribute('role', 'status');
      this.announcer.setAttribute('aria-live', 'polite');
      overlayLayer().append(this.announcer);
    }
    return this.announcer;
  }

  /** Empties the region, then fills it on the next frame, so the same text twice (Retry) is read again. */
  private announce(text: string): void {
    const live = this.ensureAnnouncer();
    live.textContent = '';
    requestAnimationFrame(() => {
      if (live.isConnected) live.textContent = text;
    });
  }

  /** Moves the tooltip's content into a scrolling body, so a long step fits small or zoomed screens and the arrow stays outside it. */
  private wrapBody(tip: HTMLElement): void {
    const body = el('div', 'tip-body');
    body.append(...Array.from(tip.childNodes));
    tip.append(body);
  }

  /** Shows the tooltip for the current step, anchored to `target` with a spotlight, or centered when there is none. */
  showStep(view: RunView, target: Element | null, onLost?: () => void): void {
    this.clear();
    claimOverlay(this, () => this.clear());
    this.ensureStyle();
    // Inside an open modal dialog the tooltip must live in the dialog, or it would be inert.
    mountOverlayIn(target ? (modalDialogOf(target) ?? openModalDialog()) : openModalDialog());
    const layer = overlayLayer();
    const step = view.step;
    if (!step) return;

    const tip = this.tooltipShell(view);
    const title = el('div', 'title');
    title.dir = 'auto';
    title.append(...renderInline(step.title));
    tip.append(title);
    if (step.note) {
      const note = el('div', 'note');
      note.id = 'waymark-step-note';
      note.dir = 'auto';
      note.append(...renderInline(step.note));
      tip.append(note);
      tip.setAttribute('aria-describedby', note.id);
    }
    const buttons = el('div', 'buttons');
    if (view.stepIndex > 0) buttons.append(this.button('Back', 'back', this.h.back, 'ghost', ChevronLeft));
    buttons.append(el('span', 'spacer'));
    if (step.optional) buttons.append(this.button('Skip', 'skip', this.h.skip, 'ghost'));
    if (step.kind === 'note' || step.kind === 'input' || step.advance === 'next') {
      const last = view.stepIndex === view.total - 1;
      buttons.append(this.button(last ? 'Done' : 'Next', 'next', this.h.next, 'primary', last ? undefined : ChevronRight, true));
    }
    if (buttons.childElementCount > 1) tip.append(buttons);
    this.wrapBody(tip);
    const arrowEl = el('div', 'arrow');
    layer.append(tip);
    this.tip = tip;
    // Only for a redraw of the same step: a later step never pulls focus out of the page.
    if (this.refocus?.stepToken === view.stepToken) tip.querySelector<HTMLElement>(`[data-action="${this.refocus.action}"]`)?.focus();
    this.refocus = null;
    this.announce(`Step ${Math.min(view.stepIndex + 1, view.total)} of ${view.total}: ${plain(step.title)}`);

    if (!target) {
      tip.classList.add('centered');
      return;
    }
    tip.append(arrowEl);
    this.spot = el('div', 'spot');
    this.ring = el('div', 'ring');
    layer.append(this.spot, this.ring);
    const placement: Placement = step.placement && step.placement !== 'auto' ? step.placement : 'bottom';
    const update = () => {
      if (!target.isConnected) {
        onLost?.();
        return;
      }
      const r = target.getBoundingClientRect();
      const { hole } = spotlightPanels({ x: r.left, y: r.top, w: r.width, h: r.height }, window.innerWidth, window.innerHeight);
      const box = { left: `${hole.x}px`, top: `${hole.y}px`, width: `${hole.w}px`, height: `${hole.h}px` };
      if (this.spot) Object.assign(this.spot.style, box);
      if (this.ring) Object.assign(this.ring.style, box);
      void computePosition(target, tip, {
        strategy: 'fixed',
        placement,
        middleware: [
          offset(14),
          flip({ padding: 8 }),
          // Long steps on small or zoomed screens: the body scrolls instead of running off the edge.
          // Never shift across the target: the tooltip must not cover the element the learner clicks.
          size({ padding: 8, apply: ({ availableHeight }) => tip.style.setProperty('--wm-tip-max', `${Math.max(96, Math.floor(availableHeight))}px`) }),
          shift({ padding: 8 }),
          arrow({ element: arrowEl, padding: 12 }),
        ],
      }).then(({ x, y, placement: final, middlewareData }) => {
        Object.assign(tip.style, { left: `${x}px`, top: `${y}px` });
        // The arrow sits on the tooltip's side that faces the target.
        const side = ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[final.split('-')[0] as 'top' | 'bottom' | 'left' | 'right'];
        const a = middlewareData.arrow;
        arrowEl.dataset.side = side;
        // Shifted so far that the arrow would point past the target: hide it.
        arrowEl.hidden = !!a?.centerOffset;
        Object.assign(arrowEl.style, { left: a?.x != null ? `${a.x}px` : '', top: a?.y != null ? `${a.y}px` : '', right: '', bottom: '', [side]: '-7px' });
      });
    };
    this.stopAuto = autoUpdate(target, tip, update, { animationFrame: false });
  }

  showCard(kind: Card, view: RunView): void {
    this.refocus = null; // a Repeat that ended on a card: nothing to give focus back to
    this.clear();
    claimOverlay(this, () => this.clear());
    this.ensureStyle();
    mountOverlayIn(openModalDialog());
    const tip = this.tooltipShell(view);
    tip.classList.add('centered');
    tip.dataset.card = kind;
    const icon = el('div', 'badge-icon');
    const title = el('div', 'title');
    const note = el('div', 'note');
    note.dir = 'auto';
    const buttons = el('div', 'buttons');
    if (kind === 'done') {
      icon.append(buildSvg(CircleCheck));
      title.textContent = 'Done!';
      note.textContent = `You finished “${view.guideTitle ?? 'this guide'}”.`;
      buttons.append(el('span', 'spacer'), this.button('Close', 'close', this.h.exit, 'primary', undefined, true));
    } else if (kind === 'not-found') {
      icon.append(buildSvg(TriangleAlert));
      title.textContent = 'Waymark can’t find this step on the page.';
      note.append('Step: ', ...(view.step ? renderInline(view.step.title) : []));
      buttons.append(
        this.button('Report broken step', 'report', this.h.report),
        el('span', 'spacer'),
        this.button('Skip', 'skip', this.h.skip),
        this.button('Retry', 'retry', this.h.retry, 'primary', undefined, true),
      );
    } else {
      icon.append(buildSvg(MapPin));
      title.textContent = 'This step is on another page.';
      note.append('Step: ', ...(view.step ? renderInline(view.step.title) : []));
      buttons.append(el('span', 'spacer'), this.button('Skip', 'skip', this.h.skip), this.button('Go back', 'go-back', this.h.goBack, 'primary', undefined, true));
    }
    tip.append(icon, title, note, buttons);
    this.wrapBody(tip);
    overlayLayer().append(tip);
    this.tip = tip;
    this.announce(`${title.textContent} ${note.textContent ?? ''}`.trim());
  }

  /** Small confirmation inside the current tooltip (e.g. after reporting a broken step). */
  flash(message: string): void {
    if (!this.tip) return;
    const note = el('div', 'flash', message);
    const buttons = this.tip.querySelector('.buttons');
    if (buttons) buttons.before(note);
    else this.tip.querySelector('.tip-body')?.append(note);
    this.announce(message);
  }

  clear(): void {
    releaseOverlay(this);
    this.stopAuto?.();
    this.stopAuto = null;
    this.spot?.remove();
    this.spot = null;
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
    // Keep focus in the app's field: clicks on the tooltip never take it.
    tip.addEventListener('mousedown', (e) => e.preventDefault());
    tip.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.h.exit();
      }
    });
    const n = Math.min(view.stepIndex + 1, view.total);
    const head = el('div', 'head');
    head.append(el('span', 'count', `Step ${n} of ${view.total}`));
    // Mute toggle: reflects the global voice setting; the service worker stops speech. It reads
    // the current state when pressed, so it works again before the step changes (D106).
    this.muted = view.muted;
    const mute = this.iconButton(view.muted ? VolumeX : Volume2, 'mute', 'Mute voice', () => this.h.mute(!this.muted));
    const exit = this.iconButton(X, 'exit', 'Exit guide', this.h.exit);
    const { replayVoice, repeat: repeatStep } = this.h;
    if (view.step && view.status === 'running' && replayVoice && repeatStep) {
      // Off while muted, but still focusable, so its label says why (aria-disabled, D94).
      const replay = this.iconButton(Speech, 'replay-voice', 'Replay voice', () => {
        if (!this.muted) replayVoice();
      });
      const repeat = this.iconButton(RotateCcw, 'repeat', 'Repeat step', () => {
        // Only a keyboard user's focus comes back: a mouse press never takes focus (mousedown).
        this.refocus = repeat.matches(':focus') ? { action: 'repeat', stepToken: view.stepToken } : null;
        repeatStep();
      });
      head.append(repeat, replay);
    }
    head.append(mute, exit);
    this.paintMute(head, view.muted);
    const progress = el('div', 'progress');
    progress.setAttribute('aria-hidden', 'true');
    const bar = el('span');
    bar.style.width = `${view.total ? (n / view.total) * 100 : 0}%`;
    progress.append(bar);
    tip.append(head, progress);
    return tip;
  }

  private muted = false;

  /** The mute and Replay voice buttons for the current state; Replay voice says why it is off. */
  private paintMute(scope: ParentNode, muted: boolean): void {
    const mute = scope.querySelector<HTMLButtonElement>('[data-action="mute"]');
    if (mute) {
      mute.setAttribute('aria-pressed', String(muted));
      mute.querySelector('svg')?.replaceWith(buildSvg(muted ? VolumeX : Volume2));
    }
    const replay = scope.querySelector<HTMLButtonElement>('[data-action="replay-voice"]');
    if (replay) {
      replay.setAttribute('aria-disabled', String(muted));
      const label = muted ? 'Replay voice (voice is muted)' : 'Replay voice';
      replay.setAttribute('aria-label', label);
      replay.title = label;
    }
  }

  /** A mute change during a step updates the tooltip in place (no redraw, no new announcement). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.tip) this.paintMute(this.tip, muted);
  }

  private iconButton(icon: IconNode, action: string, label: string, fn: () => void): HTMLButtonElement {
    const b = this.button('', action, fn, 'icon');
    b.setAttribute('aria-label', label);
    b.title = label;
    b.append(buildSvg(icon));
    return b;
  }

  private button(label: string, action: string, fn: () => void, variant?: 'primary' | 'ghost' | 'icon', icon?: IconNode, trailing = false): HTMLButtonElement {
    const b = el('button', variant);
    b.type = 'button';
    if (icon && !trailing) b.append(buildSvg(icon));
    if (label) b.append(label);
    if (icon && trailing) b.append(buildSvg(icon));
    b.dataset.action = action;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  }
}
