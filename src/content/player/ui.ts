/**
 * Player overlay UI (SPEC: Player and overlay): spotlight panels, a Floating UI tooltip and the
 * not-found, off-track and done cards. Everything lives in the overlay host's shadow root and
 * is built with DOM APIs (user strings never reach innerHTML).
 */
import { arrow, autoUpdate, computePosition, flip, offset, shift, size, type Placement } from '@floating-ui/dom';
import { ChevronLeft, ChevronRight, CircleCheck, Copy, Crosshair, MapPin, RotateCcw, Search, Speech, TriangleAlert, Volume2, VolumeX, X, type IconNode } from 'lucide';
import { buildSvg } from '../../ui/svg';
import type { RunView } from '../../core/player/run';
import { spotlightPanels } from '../../core/player/spotlight';
import { renderInline } from '../../core/text/markdown';
import { composedParent } from '../../core/fingerprint/dom';
import { claimOverlay, eventPath, isOverlayPath, mountOverlayIn, overlayLayer, overlayRoot, releaseOverlay } from '../overlay/host';
import { DUR, EASE, reducedMotion } from '../../ui/motion';
import { testMark } from '../test-hooks';
import { DEFAULT_SHADE, isShade, type Shade } from '../../core/player/shade';
import { isRange } from '../../core/sheets';

/** A docked tooltip (D206): this far from the right edge, and above the launcher in the corner. */
const DOCK_GAP_PX = 16;
/** How often the ring follows a box that moves on its own (a Sheets cell, D208). */
const FOLLOW_MS = 150;
/** A screen-reader message waits this long, so the step's own announcement is heard first (D208). */
const SAY_AFTER_MS = 1500;
const DOCK_BOTTOM_PX = 84;
/** Smaller than this, a docked tooltip would sit on the grid's top-left anyway: it floats next to the Name Box. */
const DOCK_MIN_W = 720;
const DOCK_MIN_H = 520;

/** Test builds: how many glides and ripples ran (`data-waymark-test-motion`), since e2e can't see into the closed root. */
const motionCount = { glide: 0, ripple: 0 };
function countMotion(kind: keyof typeof motionCount): void {
  if (!__WAYMARK_TEST__) return;
  motionCount[kind]++;
  testMark('motion', `glide:${motionCount.glide},ripple:${motionCount.ripple}`);
}

/** The spotlight glides from the last step only if that step was on screen this recently (D133). */
export const GLIDE_WINDOW_MS = 1500;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CSS = `
.spot { position: fixed; z-index: 0; border-radius: 8px; pointer-events: none; box-sizing: border-box;
  box-shadow: 0 0 0 9999px var(--wm-shade, var(--wm-scrim)); }
/* The shade (D144) changes only the dim's colour: the hole, the ring and forced colours stay as they are. */
.spot[data-shade='lighter'] { --wm-shade: var(--wm-scrim-lighter); }
.spot[data-shade='darker'] { --wm-shade: var(--wm-scrim-darker); }
.ring { position: fixed; z-index: 1; border-radius: 8px; pointer-events: none; box-sizing: border-box; transform-origin: 0 0;
  border: 2px solid var(--wm-ring); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .55), 0 0 0 2px rgba(255, 255, 255, .85), 0 0 0 6px color-mix(in srgb, var(--wm-ring) 30%, transparent); }
.tip, .tip-out { position: fixed; z-index: 2; top: 0; left: 0; width: max-content; max-width: min(360px, calc(100vw - 16px));
  box-sizing: border-box; background: var(--wm-surface); color: var(--wm-fg); border: 1px solid var(--wm-border); border-radius: var(--wm-radius-lg);
  pointer-events: auto; box-shadow: var(--wm-shadow-3); font: 14px/1.45 var(--wm-font); text-align: left; }
.tip-body { padding: 14px 16px 12px; max-height: var(--wm-tip-max, calc(100vh - 16px)); overflow: auto; overscroll-behavior: contain; border-radius: inherit; }
:is(.tip, .tip-out).centered { left: 50%; top: 24px; transform: translateX(-50%); }
:is(.tip, .tip-out).centered .tip-body { max-height: calc(100vh - 48px); }
/* The tooltip that just went: a copy fading up and away (D133). Inert, hidden from screen readers. */
.tip-out { pointer-events: none; z-index: 1; }
/* "Click registered": a ring that grows out of the target and fades (D133). */
.ripple { position: fixed; z-index: 1; border-radius: 8px; pointer-events: none; box-sizing: border-box; border: 2px solid var(--wm-ring); opacity: 0; }
.arrow[hidden] { display: none; }
:is(.tip, .tip-out) *, :is(.tip, .tip-out) *::before, :is(.tip, .tip-out) *::after { box-sizing: border-box; }
.arrow { position: absolute; width: 12px; height: 12px; background: var(--wm-surface); transform: rotate(45deg); pointer-events: none; }
.arrow[data-side='top'] { border-left: 1px solid var(--wm-border); border-top: 1px solid var(--wm-border); }
.arrow[data-side='bottom'] { border-right: 1px solid var(--wm-border); border-bottom: 1px solid var(--wm-border); }
.arrow[data-side='left'] { border-left: 1px solid var(--wm-border); border-bottom: 1px solid var(--wm-border); }
.arrow[data-side='right'] { border-right: 1px solid var(--wm-border); border-top: 1px solid var(--wm-border); }
.head { display: flex; align-items: center; gap: 8px; margin: -4px -8px 0 0; }
.count { flex: 1; font-size: 12px; font-weight: 600; color: var(--wm-fg-muted); font-variant-numeric: tabular-nums; letter-spacing: .02em; }
.progress { height: 3px; border-radius: 999px; background: var(--wm-surface-2); margin: 6px 0 10px; overflow: hidden; }
.progress > span { display: block; height: 100%; background: var(--wm-accent); border-radius: inherit; transform-origin: left center; }
.badge-icon { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; margin: 2px 0 8px;
  background: var(--wm-accent-soft); color: var(--wm-accent-text); }
.badge-icon svg { width: 20px; height: 20px; }
[data-card='done'] .badge-icon { background: var(--wm-success-soft); color: var(--wm-success); }
/* Done (D89): the check beside "Done!" and the guide's name, Close under them; no header. */
[data-card='done'] { min-width: min(280px, calc(100vw - 16px)); }
[data-card='done'] .tip-body { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 12px; align-items: center; padding: 14px 16px; }
[data-card='done'] .badge-icon { grid-row: 1 / span 2; align-self: center; margin: 0; width: 40px; height: 40px; }
[data-card='done'] .badge-icon svg { width: 22px; height: 22px; }
[data-card='done'] .title { align-self: end; }
[data-card='done'] .note { align-self: start; margin-top: 2px; }
[data-card='done'] .buttons { grid-column: 1 / -1; margin-top: 12px; }
[data-card='not-found'] .badge-icon { background: var(--wm-warn-soft); color: var(--wm-warn); }
.title { font-size: 15px; font-weight: 600; line-height: 1.4; margin: 0; overflow-wrap: anywhere; }
.title strong { font-weight: 700; }
.menu-hint { display: block; margin-top: 4px; }
.note { margin: 6px 0 0; color: var(--wm-fg-muted); font-size: 13.5px; overflow-wrap: anywhere; }
.hint { margin: 8px 0 0; display: flex; gap: 6px; align-items: center; color: var(--wm-accent-text); font-size: 12.5px; font-weight: 500; }
.hint::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--wm-accent); }
.flash { margin: 10px 0 0; padding: 6px 10px; border-radius: var(--wm-radius-sm); background: var(--wm-success-soft); color: var(--wm-success); font-size: 13px; }
.flash.warn { background: var(--wm-warn-soft); color: var(--wm-warn); }
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
/* Motion (D130, D133): transform and opacity only, all off under reduced motion (D93). */
@media (prefers-reduced-motion: no-preference) {
  .tip { animation: wm-tip-in var(--wm-dur-base) var(--wm-ease-enter); }
  .tip.centered { animation-name: wm-card-in; }
  .tip-out { animation: wm-tip-out var(--wm-dur-fast) var(--wm-ease-exit) forwards; }
  .ring { animation: wm-ring-in 220ms var(--wm-ease), wm-ring-pulse 1.6s ease-in-out 240ms 2; }
  /* Gliding from the last step: it is already there, so no fade-in; the pulse waits for the glide. */
  .ring.glide { animation: wm-ring-pulse 1.6s ease-in-out var(--wm-dur-slow) 2; }
  .spot { animation: wm-fade-in 200ms var(--wm-ease); }
  .spot.still { animation: none; }
  .ripple { animation: wm-ripple var(--wm-dur-slow) var(--wm-ease-exit); }
  [data-card='done'] .badge-icon svg { animation: wm-pop var(--wm-dur-slow) var(--wm-ease-spring) backwards; }
  [data-card='not-found'] .badge-icon { animation: wm-shake var(--wm-dur-slow) var(--wm-ease-standard); }
  button { transition: background-color var(--wm-dur-fast) var(--wm-ease-standard), border-color var(--wm-dur-fast) var(--wm-ease-standard), transform var(--wm-dur-fast) var(--wm-ease-spring); }
  button:active { transform: scale(var(--wm-press)); transition-duration: var(--wm-dur-press); }
  button:focus-visible { animation: wm-focus-in var(--wm-dur-fast) var(--wm-ease-enter); }
}
button:active { box-shadow: inset 0 1px 2px rgba(16, 24, 40, .18); }
@keyframes wm-tip-in { from { opacity: 0; translate: 0 var(--wm-move-md); } }
@keyframes wm-tip-out { to { opacity: 0; translate: 0 calc(-1 * var(--wm-move-md)); } }
@keyframes wm-card-in { from { opacity: 0; translate: 0 -6px; } }
@keyframes wm-ripple { from { opacity: .7; scale: 1; } to { opacity: 0; scale: 1.18; } }
@keyframes wm-pop { from { opacity: 0; scale: .4; rotate: -20deg; } }
@keyframes wm-shake { 25% { translate: -3px 0; } 50% { translate: 3px 0; } 75% { translate: -2px 0; } }
@keyframes wm-focus-in { from { outline-offset: 5px; outline-color: transparent; } }
@keyframes wm-fade-in { from { opacity: 0; } }
@keyframes wm-ring-in { from { opacity: 0; } }
@keyframes wm-ring-pulse { 50% { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .55), 0 0 0 2px rgba(255, 255, 255, .85), 0 0 0 10px color-mix(in srgb, var(--wm-ring) 18%, transparent); } }
@media (forced-colors: active) {
  .tip, .tip-out { border: 2px solid CanvasText; }
  .ripple { border-color: Highlight; }
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
  /** True while the debug log is on: the not-found card offers Copy log (D111). */
  debugOn?(): boolean;
  copyLog?(): void;
  /** Pick the right element (D210): only in a real run of the author's own guide (`view.fixable`). */
  fix?(): void;
  /** A Sheets cell step's "Show again" (D208): select the step's cell again and point at it. */
  showCell?(): void;
}

export type Card = 'not-found' | 'off-track' | 'done' | 'searching';

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

/**
 * What the learner does on the page to move on, for steps without a Next button (D127). First-time
 * learners waited for a Next button that action steps don't have.
 */
export function actionHint(step: Pick<NonNullable<RunView['step']>, 'kind' | 'advance' | 'cell'>): string | null {
  if (step.advance !== 'action') return null;
  if (step.kind === 'cell' && step.cell && isRange(step.cell.ref)) return 'Waymark selected these cells. Press Next to continue.';
  // Typing into a Sheets cell the player selected (D208).
  if (step.kind === 'input' && step.cell) return 'Type into the highlighted cell, then press Enter or Tab.';
  switch (step.kind) {
    case 'click':
      return 'Click the highlighted item to continue.';
    case 'input':
      return 'Fill in the highlighted field to continue.';
    case 'select':
      return 'Choose an option to continue.';
    case 'check':
      return 'Tick or untick it to continue.';
    case 'submit':
      return 'Send the form to continue.';
    case 'navigate':
      return 'Go to that page to continue.';
    case 'hover':
      return 'Point at the highlighted item (or Tab to it) to continue.';
    case 'cell':
      return 'Waymark selected the highlighted cell. Click it to continue, or press Next.';
    default:
      return null;
  }
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
  /** The spotlight and ring follow this box instead of the target (a Sheets cell, D208), while it gives one. */
  private boxOverride: (() => DOMRect | null) | null = null;
  private redraw: (() => void) | null = null;
  /** The step's action hint, and its own words, so a note can replace them for a while (D208). */
  private hintLine: { el: HTMLElement; text: string } | null = null;
  private followTimer: ReturnType<typeof setInterval> | null = null;
  /** Motion memory (D133): where the ring last was, and the progress bar's last value, per run. */
  private lastHole: (Box & { run: string; token: string | null; at: number }) | null = null;
  private lastProgress: { run: string; frac: number } | null = null;
  private stopPress: (() => void) | null = null;
  /** The learner closed the guide: the tooltip that goes now leaves with a rise (D133). */
  private exiting = false;
  private exitTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly exitGuide = () => {
    this.exiting = true;
    clearTimeout(this.exitTimer);
    // The run may end a little later (a message round trip): a clear() until then is the exit.
    this.exitTimer = setTimeout(() => (this.exiting = false), 1000);
    this.h.exit();
  };

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
    this.shade = isShade(view.shade) ? view.shade : DEFAULT_SHADE;
    this.clear();
    this.dropLeaving();
    claimOverlay(this, () => this.clear());
    this.ensureStyle();
    // Inside an open modal dialog the tooltip must live in the dialog, or it would be inert.
    mountOverlayIn(target ? (modalDialogOf(target) ?? openModalDialog()) : openModalDialog());
    const layer = overlayLayer();
    const step = view.step;
    if (!step) return;

    const tip = this.tooltipShell(view);
    // A wrong element highlighted on the author's own guide: Pick the right element (D210).
    const fix = this.h.fix;
    if (target && fix && view.fixable && view.status === 'running') {
      tip.querySelector('.head [data-action="mute"]')?.before(this.iconButton(Crosshair, 'fix', 'Pick the right element', fix));
    }
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
    // Only in a real run (Test step's highlight in the editor has no voice handlers and no run).
    const hint = target && this.h.replayVoice ? actionHint(step) : null;
    if (hint) {
      const line = el('p', 'hint', hint);
      line.id = 'waymark-step-hint';
      line.dataset.testid = 'action-hint';
      this.hintLine = { el: line, text: hint };
      tip.append(line);
      // Screen readers hear it with the tooltip, after the note.
      tip.setAttribute('aria-describedby', [tip.getAttribute('aria-describedby'), line.id].filter(Boolean).join(' '));
    }
    const buttons = el('div', 'buttons');
    if (view.stepIndex > 0) buttons.append(this.button('Back', 'back', this.h.back, 'ghost', ChevronLeft));
    buttons.append(el('span', 'spacer'));
    if (step.optional) buttons.append(this.button('Skip', 'skip', this.h.skip, 'ghost'));
    // A hover step whose trigger can't take keyboard focus: Next, so keyboard users are not stuck (D204).
    const unfocusable = step.kind === 'hover' && !(target instanceof HTMLElement && target.tabIndex >= 0);
    // A Sheets cell step (D206): Next too, for a sheet renamed since or a cell out of reach.
    // The player selected the step's cell (D208); "Show again" selects it again if the learner moved away.
    if (step.cell && this.h.showCell) {
      const again = this.button('Show again', 'show-cell', this.h.showCell, 'ghost', MapPin);
      again.setAttribute('aria-label', `Select ${isRange(step.cell.ref) ? 'cells' : 'cell'} ${step.cell.ref} again`);
      buttons.append(again);
    }
    if (step.kind === 'note' || step.kind === 'input' || step.advance === 'next' || unfocusable || step.kind === 'cell') {
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
      this.lastHole = null;
      return;
    }
    tip.append(arrowEl);
    this.spot = el('div', 'spot');
    this.paintShade();
    this.ring = el('div', 'ring');
    // Moving on from a step that was just on screen: the ring glides from there, and the dim
    // stays (no fade-in flash). The hole itself is at the new target at once, so the target is
    // never dimmed, and nothing waits for the glide (D133).
    const run = `${view.guideId}|${view.runId}`;
    const last = this.lastHole;
    let glideFrom: Box | null = last && last.run === run && last.token !== view.stepToken && performance.now() - last.at < GLIDE_WINDOW_MS && !reducedMotion() ? last : null;
    if (glideFrom) {
      this.ring.classList.add('glide');
      this.spot.classList.add('still');
    }
    layer.append(this.spot, this.ring);
    this.watchPress(target, step);
    const placement: Placement = step.placement && step.placement !== 'auto' ? step.placement : 'bottom';
    // A Sheets cell step (D206) rings the Name Box, which sits right above the grid's top-left
    // cells, the ones learners pick most. Next to it the tooltip would cover them (there is no room
    // above it), so it docks in the bottom-right corner instead, unless the author placed it.
    const docked = !!step.cell && (!step.placement || step.placement === 'auto') && window.innerWidth >= DOCK_MIN_W && window.innerHeight >= DOCK_MIN_H;
    if (docked) tip.classList.add('docked');
    const update = () => {
      if (!target.isConnected) {
        onLost?.();
        return;
      }
      const r = this.boxOverride?.() ?? target.getBoundingClientRect();
      const { hole } = spotlightPanels({ x: r.left, y: r.top, w: r.width, h: r.height }, window.innerWidth, window.innerHeight);
      const box = { left: `${hole.x}px`, top: `${hole.y}px`, width: `${hole.w}px`, height: `${hole.h}px` };
      if (this.spot) Object.assign(this.spot.style, box);
      if (this.ring) {
        Object.assign(this.ring.style, box);
        // Nothing to glide to yet (off screen, scrolling in): it fades in as on a first step.
        if (glideFrom && !this.glide(this.ring, glideFrom, hole)) {
          this.ring.classList.remove('glide');
          this.spot?.classList.remove('still');
        }
        glideFrom = null; // only the first draw glides; later updates follow the target
      }
      this.lastHole = { ...hole, run, token: view.stepToken, at: performance.now() };
      if (docked) {
        const t = tip.getBoundingClientRect();
        Object.assign(tip.style, { left: `${Math.max(8, window.innerWidth - t.width - DOCK_GAP_PX)}px`, top: `${Math.max(8, window.innerHeight - t.height - DOCK_BOTTOM_PX)}px` });
        arrowEl.hidden = true;
        return;
      }
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
    this.redraw = update;
  }

  /**
   * Says `text` to screen readers (a Sheets cell the player selected, D208), after the step's own
   * announcement has been read: said at once, it would replace it.
   */
  say(text: string): void {
    const token = this.tip;
    setTimeout(() => {
      if (this.tip === token && token?.isConnected) this.announce(text);
    }, SAY_AFTER_MS);
  }

  /**
   * Replaces the step's action hint with `text` (a Sheets tab to open first, D208), or puts it back
   * with null. A step without a hint line (it moves on with Next) shows it as a short message.
   */
  setHint(text: string | null): void {
    const h = this.hintLine;
    if (!h || !h.el.isConnected) {
      if (text) this.flash(text, 'warn');
      return;
    }
    const next = text ?? h.text;
    if (h.el.textContent === next) return;
    h.el.textContent = next;
    if (text) this.say(text);
  }

  /**
   * The spotlight and ring follow `box` (D208: the Sheets cell the player selected) while it gives
   * one, and the step's element otherwise. The cell moves with the grid's own scrolling, which the
   * element's observers don't see, so it is followed a few times a second.
   */
  pointAt(box: () => DOMRect | null): void {
    if (!this.redraw) return;
    this.boxOverride = box;
    this.redraw();
    if (this.followTimer) clearInterval(this.followTimer);
    this.followTimer = setInterval(() => this.redraw?.(), FOLLOW_MS);
  }

  showCard(kind: Card, view: RunView): void {
    this.refocus = null; // a Repeat that ended on a card: nothing to give focus back to
    this.clear();
    this.dropLeaving();
    this.lastHole = null; // a card has no ring to glide from
    claimOverlay(this, () => this.clear());
    this.ensureStyle();
    mountOverlayIn(openModalDialog());
    const tip = this.tooltipShell(view);
    tip.classList.add('centered');
    tip.dataset.card = kind;
    this.lastProgress = null; // a guide started again (the same tutorial has the same run id) fills from empty
    const icon = el('div', 'badge-icon');
    const title = el('div', 'title');
    const note = el('div', 'note');
    note.dir = 'auto';
    const buttons = el('div', 'buttons');
    if (kind === 'done') {
      // Nothing left to count, mute or exit: the card is the check beside its two lines and Close (D89).
      tip.querySelector('.head')?.remove();
      tip.querySelector('.progress')?.remove();
      icon.append(buildSvg(CircleCheck));
      title.textContent = 'Done!';
      note.textContent = `You finished “${view.guideTitle ?? 'this guide'}”.`;
      buttons.append(el('span', 'spacer'), this.button('Close', 'close', this.exitGuide, 'primary', undefined, true));
    } else if (kind === 'not-found') {
      icon.append(buildSvg(TriangleAlert));
      title.textContent = 'Waymark can’t find this step on the page.';
      note.append('Step: ', ...(view.step ? renderInline(view.step.title) : []));
      // Items in a menu are hidden until it opens, often by pointing at it (D204).
      note.append(el('span', 'menu-hint', ' If it’s in a menu, open the menu first (point at it or click it), then press Retry.'));
      // The author's own guide: fix the step here, by clicking the right element (D210).
      if (this.h.fix && view.fixable) buttons.append(this.button('Pick the right element', 'fix', this.h.fix, undefined, Crosshair));
      buttons.append(this.button('Report broken step', 'report', this.h.report));
      // A compact icon button, so the card's row still fits on one line (D111).
      if (this.h.copyLog && this.h.debugOn?.()) buttons.append(this.iconButton(Copy, 'copy-log', 'Copy debug log', this.h.copyLog));
      buttons.append(
        el('span', 'spacer'),
        this.button('Skip', 'skip', this.h.skip),
        this.button('Retry', 'retry', this.h.retry, 'primary', undefined, true),
      );
    } else if (kind === 'searching') {
      // Still looking (#115): say so, instead of nothing until the not-found card. Items in a
      // menu are hidden until it opens; a step flagged "in a menu" says it plainly.
      icon.append(buildSvg(Search));
      title.textContent = 'Looking for this step…';
      note.append('Step: ', ...(view.step ? renderInline(view.step.title) : []));
      const inMenu = view.step?.flags?.includes('in-menu');
      note.append(el('span', 'menu-hint', inMenu ? ' It’s in a menu: open the menu first.' : ' If it’s in a menu, open the menu first.'));
      buttons.append(el('span', 'spacer'), this.button('Skip', 'skip', this.h.skip));
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
  flash(message: string, tone: 'success' | 'warn' = 'success'): void {
    if (!this.tip) return;
    this.tip.querySelector('.flash')?.remove();
    const note = el('div', tone === 'warn' ? 'flash warn' : 'flash', message);
    const buttons = this.tip.querySelector('.buttons');
    if (buttons) buttons.before(note);
    else this.tip.querySelector('.tip-body')?.append(note);
    this.announce(message);
  }

  clear(): void {
    releaseOverlay(this);
    this.stopAuto?.();
    this.stopAuto = null;
    this.boxOverride = null;
    this.redraw = null;
    this.hintLine = null;
    if (this.followTimer) clearInterval(this.followTimer);
    this.followTimer = null;
    this.stopPress?.();
    this.stopPress = null;
    if (this.lastHole && this.ring) this.lastHole.at = performance.now(); // on screen until now
    this.spot?.remove();
    this.spot = null;
    this.ring?.remove();
    this.ring = null;
    if (this.tip && this.exiting) this.leave(this.tip);
    else this.tip?.remove();
    this.exiting = false;
    this.tip = null;
  }

  /** A guide started again during an exit: the leaving copy goes now. */
  private dropLeaving(): void {
    for (const n of Array.from(overlayRoot().querySelectorAll('.tip-out'))) n.remove();
  }

  /**
   * The ring slides and resizes from the last step's box to this one (transform only, D133).
   * Scaling the ring scales its border and halo too, so it scales only between boxes of about
   * the same size (×0.67–1.5); a bigger change (a toolbar, then an icon in it) slides the ring at
   * its new size from the old box's centre, so no stretched border is painted over the target.
   * Returns false when there was nothing to glide (the target is off screen, still scrolling in).
   */
  private glide(ring: HTMLElement, from: Box, to: Box): boolean {
    if (typeof ring.animate !== 'function' || to.w < 1 || to.h < 1) return false;
    const sx = from.w / to.w;
    const sy = from.h / to.h;
    const near = (r: number) => r >= 2 / 3 && r <= 1.5;
    const scale = near(sx) && near(sy);
    const dx = scale ? from.x - to.x : from.x + from.w / 2 - (to.x + to.w / 2);
    const dy = scale ? from.y - to.y : from.y + from.h / 2 - (to.y + to.h / 2);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(from.w - to.w) < 1 && Math.abs(from.h - to.h) < 1) return true;
    const start = scale ? `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` : `translate(${dx}px, ${dy}px)`;
    ring.animate([{ transform: start }, { transform: 'none' }], { duration: DUR.slow, easing: EASE.standard });
    countMotion('glide');
    return true;
  }

  /**
   * When the learner closes the guide, the tooltip fades up and away as an inert copy (D133).
   * Only then: between steps the new tooltip replaces it at once, since a copy fading under it
   * cost long tasks at 4× slower CPU and was barely visible. Nothing in the copy can be pressed,
   * found by tests or read: no ids, actions, role or label.
   */
  private leave(tip: HTMLElement): void {
    if (!tip.isConnected || reducedMotion() || typeof tip.getAnimations !== 'function') {
      tip.remove();
      return;
    }
    tip.classList.replace('tip', 'tip-out');
    tip.inert = true;
    tip.setAttribute('aria-hidden', 'true');
    for (const a of ['role', 'aria-label', 'aria-describedby']) tip.removeAttribute(a);
    for (const n of Array.from(tip.querySelectorAll('[id], [data-action], [data-testid]'))) {
      n.removeAttribute('id');
      n.removeAttribute('data-action');
      n.removeAttribute('data-testid');
    }
    const done = () => tip.remove();
    // Only its own end: the done card's tick and a focus ring end inside it too (and bubble).
    tip.addEventListener('animationend', (e) => e.target === tip && done());
    setTimeout(done, DUR.fast + 80);
  }

  /**
   * "Click registered" (D133): a press on the target of an action step draws a ring that grows
   * out of the spotlight and fades. A passive listener on the target only, so the page sees the
   * press exactly as before; presses that come from Waymark's own overlay are ignored.
   */
  private watchPress(target: Element, step: NonNullable<RunView['step']>): void {
    if (step.advance !== 'action' || reducedMotion()) return;
    const onDown = (e: Event) => {
      if ((e as PointerEvent).button > 0 || isOverlayPath(eventPath(e)) || !this.ring) return;
      const ripple = el('div', 'ripple');
      ripple.setAttribute('aria-hidden', 'true');
      for (const k of ['left', 'top', 'width', 'height'] as const) ripple.style[k] = this.ring.style[k];
      overlayLayer().append(ripple);
      countMotion('ripple');
      // It outlives the step (the next one may be drawn at once); it removes itself.
      const done = () => ripple.remove();
      ripple.addEventListener('animationend', done, { once: true });
      setTimeout(done, DUR.slow + 120);
    };
    target.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    this.stopPress = () => target.removeEventListener('pointerdown', onDown, { capture: true });
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
        this.exitGuide();
      }
    });
    const n = Math.min(view.stepIndex + 1, view.total);
    const head = el('div', 'head');
    head.append(el('span', 'count', `Step ${n} of ${view.total}`));
    // Mute toggle: reflects the global voice setting; the service worker stops speech. It reads
    // the current state when pressed, so it works again before the step changes (D106).
    this.muted = view.muted;
    const mute = this.iconButton(view.muted ? VolumeX : Volume2, 'mute', 'Mute voice', () => this.h.mute(!this.muted));
    const exit = this.iconButton(X, 'exit', 'Exit guide', this.exitGuide);
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
    // The fill is a scaleX, eased from the last step's value in the same run (D133).
    const frac = view.total ? n / view.total : 0;
    bar.style.transform = `scaleX(${frac})`;
    const run = `${view.guideId}|${view.runId}`;
    const prev = this.lastProgress;
    if (prev && prev.run === run && prev.frac !== frac && !reducedMotion() && typeof bar.animate === 'function') {
      bar.animate([{ transform: `scaleX(${prev.frac})` }, { transform: `scaleX(${frac})` }], { duration: DUR.slow, easing: EASE.standard });
    }
    this.lastProgress = { run, frac };
    progress.append(bar);
    tip.append(head, progress);
    return tip;
  }

  private muted = false;
  private shade: Shade = DEFAULT_SHADE;

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
  /** The run's shade (D145), resolved by the service worker; anything unknown is the default. */
  setShade(shade: unknown): void {
    this.shade = isShade(shade) ? shade : DEFAULT_SHADE;
    this.paintShade();
  }

  private paintShade(): void {
    if (!this.spot) return;
    this.spot.dataset.shade = this.shade;
    // Test builds: the dim's real colour, read from outside the closed root.
    if (__WAYMARK_TEST__) {
      const spot = this.spot;
      requestAnimationFrame(() => spot.isConnected && testMark('shade', `${this.shade}|${getComputedStyle(spot).boxShadow}`));
    }
  }

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
