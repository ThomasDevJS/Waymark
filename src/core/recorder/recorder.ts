/**
 * Recorder (SPEC: Recorder): turns raw browser events into a short list of human-sized steps.
 * Runs in every granted frame. Never stores what the author types.
 *
 * Emits operations rather than final steps, because some merges are only known later:
 * a click on a submit button becomes a submit step when the form's submit event follows.
 */
import { createHoverTracker } from './hover';
import { isSheetsGrid, nameBox, readCell } from '../sheets';
import type { ElementFingerprint, Step, StepFlag } from '../model/schema';
import type { ProfileOptions } from '../model/profile';
import { newId } from '../model/ids';
import { buildFingerprint } from '../fingerprint/build';
import { hasStrongSignal, presentSignals } from '../matcher/signals';
import { ariaRole } from '../debug/log';
import { isInteractive, resolveTargetFromPath, tagOf, type ResolvedTarget } from '../fingerprint/dom';
import { hasInteractiveAncestor, promoteToRegion } from './region';
import { safeLabel } from '../fingerprint/filters';
import { chooseOptionTitle, roleWord, stepTitle } from '../text/templates';
import { stepUrlRule } from '../url/url';
import { checkedState, isCheckLike, isCustomOption, isNativeCheck, isNativeSelect, isSensitiveField, isTextField, submitForm } from './classify';

/** `at`: when the action happened (ms since epoch), for the navigation rule (D67). */
/** Sheets moves the selection in its own handlers; the Name Box is read a moment later (D206). */
const CELL_READ_MS = 60;

export type RecorderOp = { op: 'add'; step: Step; at?: number } | { op: 'replace'; stepId: string; step: Step; at?: number };

export interface RecorderOptions {
  doc?: Document;
  emit: (op: RecorderOp) => void;
  /**
   * The element a step was emitted for, before the step goes out. The recording client keeps a
   * weak reference, so a screenshot can measure the element itself at capture time (D183).
   */
  onTarget?: (stepId: string, el: Element) => void;
  /** True for events inside Waymark's own overlay. */
  isOwnEvent?: (path: EventTarget[]) => boolean;
  framePath?: () => string[];
  profile?: ProfileOptions;
  lang?: string;
  now?: () => number;
  isVisible?: (el: Element) => boolean;
  /**
   * Called instead of emitting a step whose target could never be found again: no test id, id,
   * role + name, text, name or link (issue #6, docs/DECISIONS.md D47).
   */
  onSkip?: (reason: 'unfindable') => void;
  /**
   * Debug log (D110): what the recorder decided and why. `data` is called only by the logger, and
   * holds tags, roles, signal names, flags and step titles, never typed values or page text.
   */
  debug?: (ev: string, data: () => Record<string, unknown>) => void;
}

/** What a fingerprint can be found by, for the debug log: names only. */
export function fpFacts(fp: ElementFingerprint): Record<string, unknown> {
  return { tag: fp.tag, role: ariaRole(fp.role), signals: presentSignals(fp), instance: fp.instance, alike: fp.matchCount, strong: hasStrongSignal(fp) };
}

export const PENDING_LINK_MS = 1000;
/** A press and a click on its ancestor are one click only when released this close to the press (D61). */
export const PRESS_SLOP_PX = 4;
export const SUBMIT_MERGE_MS = 1500;

interface Pending {
  el: Element;
  fp: ElementFingerprint;
  time: number;
  path: EventTarget[];
  /** Pointer position of the press (pending only). */
  x?: number;
  y?: number;
  /** Name for the step title when the target is a clickable region (D82): the text clicked. */
  name?: string;
  /** The press resolved to a clickable region (D82). */
  promoted?: boolean;
}

interface LastStep {
  id: string;
  kind: Step['kind'];
  el: Element;
  time: number;
  form: HTMLFormElement | null;
  fp: ElementFingerprint;
  /** Left out as unfindable: merge guards still see it (one skip per field), but it never merges. */
  skipped?: boolean;
}

export interface Recorder {
  stop(): void;
}

export function createRecorder(opts: RecorderOptions): Recorder {
  const doc = opts.doc ?? document;
  const now = opts.now ?? (() => Date.now());
  const lang = opts.lang ?? 'en';
  const isOwn = opts.isOwnEvent ?? (() => false);
  // Never throws into the recorder; does nothing without a logger.
  const dbg = (ev: string, data: () => Record<string, unknown>) => {
    if (!opts.debug) return;
    try {
      opts.debug(ev, data);
    } catch {
      // ignore
    }
  };

  let pending: Pending | null = null; // built on pointerdown, before the app can re-render
  let fieldClick: Pending | null = null; // click into a field or native select, waiting for input/change
  let last: LastStep | null = null;
  let enter: { el: Element; time: number } | null = null;
  // Controls already recorded in the current task: a label click forwards a second click to its
  // control, and a native checkbox then fires change, all in the same task.
  const sameTask = new Set<Element>();
  const markSameTask = (el: Element) => {
    sameTask.add(el);
    const timer = setTimeout(() => {
      timers.delete(timer);
      sameTask.delete(el);
    }, 0);
    timers.add(timer);
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const fpOf = (el: Element) =>
    buildFingerprint(el, { profile: opts.profile, framePath: opts.framePath?.() ?? [], ...(opts.isVisible ? { isVisible: opts.isVisible } : {}) });

  const nameFor = (el: Element, fp: ElementFingerprint) =>
    fp.accessibleName ?? fp.text ?? fp.placeholder ?? fp.name ?? safeLabel(el.getAttribute('title')) ?? fp.itemLabel ?? roleWord(fp.role);

  /**
   * The click target, where a click on plain content inside a clickable region (a card <div> with
   * a click handler and a pointer cursor) records the region when it has something to find it by
   * again (D82). Otherwise the content itself, low-confidence, as before.
   */
  type Resolved = ResolvedTarget & { fp?: ElementFingerprint; name?: string; region?: string };
  const resolveTarget = (path: EventTarget[]): Resolved | null => {
    const t = resolveTargetFromPath(path);
    if (!t || !t.lowConfidence) return t;
    // The press already promoted this click's region: reuse it rather than fingerprint it again.
    const p = pending;
    if (p?.promoted && now() - p.time <= PENDING_LINK_MS && path.includes(p.el)) return { element: p.el, lowConfidence: false, fp: p.fp, ...(p.name ? { name: p.name } : {}), region: 'promoted at the press (D82)' };
    let why = '';
    const up = promoteToRegion(t, fpOf, opts.debug ? (r) => (why = r) : undefined);
    return up ? { element: up.element, lowConfidence: false, fp: up.fp, ...(up.name ? { name: up.name } : {}), region: 'promoted (D82)' } : { ...t, ...(why ? { region: `not promoted: ${why}` } : {}) };
  };

  const flagsFor = (el: Element, lowConfidence: boolean): StepFlag[] | undefined => {
    const flags: StepFlag[] = [];
    if (lowConfidence) flags.push('low-confidence');
    if (tagOf(el) === 'canvas') flags.push('canvas');
    if (tagOf(el).includes('-') && !el.shadowRoot && !isInteractive(el) && el.childElementCount === 0) flags.push('closed-shadow');
    return flags.length ? flags : undefined;
  };

  /** The page and time of an action, taken when it happens (a handler may change the route). */
  type When = { at: number; url: string };
  const whenNow = (): When => ({ at: now(), url: doc.URL });
  const makeStep = (kind: Step['kind'], el: Element, fp: ElementFingerprint, title: string, flags?: StepFlag[], when?: When, extra?: Pick<Step, 'cell'>): Step => {
    const step: Step = { id: newId(), kind, title, url: stepUrlRule(when?.url ?? doc.URL, opts.profile), target: fp, advance: 'action', ...extra };
    if (flags) step.flags = flags;
    return step;
  };

  const add = (kind: Step['kind'], el: Element, fp: ElementFingerprint, title: string, flags?: StepFlag[], when: When = whenNow(), extra?: Pick<Step, 'cell'>) => {
    if (!hasStrongSignal(fp)) {
      dbg('skip', () => ({ why: 'nothing to find it by again (D47)', kind, ...fpFacts(fp) }));
      opts.onSkip?.('unfindable');
      last = { id: '', kind, el, time: now(), form: null, fp, skipped: true };
      return null;
    }
    const step = makeStep(kind, el, fp, title, flags, when, extra);
    last = { id: step.id, kind, el, time: now(), form: kind === 'click' || kind === 'submit' ? submitForm(el) : null, fp };
    dbg('emit', () => ({ op: 'add', kind, title: title.replace(/\*\*/g, ''), flags: flags ?? [], ...fpFacts(fp) }));
    opts.onTarget?.(step.id, el);
    opts.emit({ op: 'add', step, at: when.at });
    return step;
  };

  /** A click into a field that was never typed into still counts as a click (date pickers, etc.). */
  const flushFieldClick = (except?: Element) => {
    const f = fieldClick;
    if (!f || f.el === except) return;
    fieldClick = null;
    if (isTextField(f.el)) {
      dbg('field.click', () => ({ why: 'a click into a field that was not typed into stays a click' }));
      add('click', f.el, f.fp, stepTitle('click', { name: nameFor(f.el, f.fp) }, lang));
    }
  };

  const trusted = (e: Event) => e.isTrusted && !isOwn(e.composedPath());

  // Google Sheets cells (D206): the grid is a canvas, so a click there (or a reference typed into
  // the Name Box, then Enter) becomes "Select cell B8", read from the Name Box once Sheets has
  // moved the selection. Clicking around the grid before acting keeps only the last selection.
  const isSheetsNameBox = (el: Element) => el === nameBox(doc) && !!doc.getElementById('waffle-grid-container');
  const recordCell = (via: string) => {
    const when = whenNow();
    const timer = setTimeout(() => {
      timers.delete(timer);
      const c = readCell(doc);
      const box = nameBox(doc);
      if (!c || !box) {
        dbg('skip', () => ({ why: 'Sheets: the Name Box shows no cell reference (a named range?), so there is nothing to select again (D206)', via }));
        return;
      }
      const fp = fpOf(box);
      const title = stepTitle('cell', { name: c.ref, ...(c.sheet ? { sheet: c.sheet } : {}) }, lang);
      if (last && last.kind === 'cell' && !last.skipped && last.id) {
        const step = makeStep('cell', box, fp, title, undefined, when, { cell: c });
        step.id = last.id;
        last.time = now();
        dbg('merge', () => ({ why: 'Sheets: another cell selected right after: the step keeps the last one (D206)', via }));
        opts.emit({ op: 'replace', stepId: last.id, step });
        return;
      }
      dbg('cell', () => ({ why: 'Sheets: a cell selected on the grid is read from the Name Box (D206)', via, sheet: c.sheet ? 'yes' : 'no' }));
      add('cell', box, fp, title, undefined, when, { cell: c });
    }, CELL_READ_MS);
    timers.add(timer);
  };

  // Menus that open while the pointer rests on their trigger (D204): what changed in the page,
  // and where the pointer rested, so a click on such a menu's item gets a "Point at" step first.
  const hover = createHoverTracker();
  const MO = doc.defaultView?.MutationObserver;
  const observer = MO
    ? new MO((records) => hover.mutated(records, now()))
    : null;
  const observe = (n: Node) =>
    observer?.observe(n, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'open', 'data-state', 'aria-expanded'] });
  observe(doc.documentElement ?? doc);
  const onOver = (e: Event) => {
    if (!trusted(e)) return;
    const path = e.composedPath();
    watchRoots(path);
    hover.over(path, now());
  };
  const onScroll = () => hover.scrolled(now());
  // Typing counts as activity: suggestions that appear for it are not a hover menu.
  let typedAt = 0;
  /**
   * The "Point at" steps a click on `el` needs first (D204), outermost first: a submenu's trigger
   * was itself revealed by pointing at the menu's trigger (at most 3 levels).
   */
  const maybeHover = (el: Element) => {
    const at = now();
    const since = Math.max(last?.time ?? 0, typedAt);
    const chain: Element[] = [];
    for (let h = hover.triggerFor(el, at, since); h && chain.length < 3 && !chain.includes(h); h = hover.triggerFor(h, at, since)) chain.unshift(h);
    for (const h of chain) {
      const hfp = fpOf(h);
      if (!hasStrongSignal(hfp)) {
        dbg('hover.skipped', () => ({ why: 'the menu opened on hover, but its trigger has nothing to find it by again (D47)', ...fpFacts(hfp) }));
        return;
      }
    }
    for (const h of chain) {
      const hfp = fpOf(h);
      dbg('hover', () => ({ why: 'the clicked item appeared after the pointer rested on another element (D204)', ...fpFacts(hfp) }));
      add('hover', h, hfp, stepTitle('hover', { name: nameFor(h, hfp) }, lang));
    }
  };

  const onPointerDown = (e: Event) => {
    if (!trusted(e)) return;
    const path = e.composedPath();
    watchRoots(path);
    const t = resolveTarget(path);
    if (!t || t.lowConfidence) {
      pending = null;
      return;
    }
    const m = e as PointerEvent;
    pending = { el: t.element, fp: t.fp ?? fpOf(t.element), time: now(), path, x: m.clientX, y: m.clientY, ...(t.fp ? { promoted: true } : {}), ...(t.name ? { name: t.name } : {}) };
  };


  const onClick = (e: Event) => {
    if (!trusted(e)) {
      if (!e.isTrusted) dbg('ignored', () => ({ why: 'a click made by a script (not trusted)' }));
      return;
    }
    if ((e as MouseEvent).detail > 1) {
      dbg('ignored', () => ({ why: 'second click of a double-click' }));
      return; // a double-click is one click step
    }
    const path = e.composedPath();
    watchRoots(path);
    if (isSheetsGrid(path, doc)) {
      flushFieldClick();
      return recordCell('click');
    }
    let t: Resolved | null = resolveTarget(path);
    if (!t) {
      dbg('ignored', () => ({ why: 'no element on the click path' }));
      return;
    }
    // Pressed on a control that opened something over itself (MUI's select opens on mousedown
    // behind a full-page backdrop): the mouseup lands on the backdrop, so the click goes to the
    // common ancestor of the two. That ancestor is on the pressed control's path (D61).
    const pressed = pending;
    const m = e as MouseEvent;
    const atPress = !!pressed && pressed.x !== undefined && pressed.y !== undefined && Math.hypot(m.clientX - pressed.x, m.clientY - pressed.y) <= PRESS_SLOP_PX; // not a drag-off cancel
    if (t.lowConfidence && pressed && atPress && now() - pressed.time <= PENDING_LINK_MS && pressed.path.includes(t.element) && !path.includes(pressed.el)) {
      dbg('press.link', () => ({ why: 'released on an ancestor of the pressed control: the press counts (D61)', tag: tagOf(pressed.el) }));
      t = { element: pressed.el, lowConfidence: false, ...(pressed.name ? { name: pressed.name } : {}) };
    }
    const el = t.element;
    const tag = tagOf(el);
    const resolved = t;
    dbg('target', () => ({ tag, lowConfidence: resolved.lowConfidence, interactive: isInteractive(el), ...(resolved.region ? { region: resolved.region } : {}) }));
    if (tag === 'html' || tag === 'body') {
      dbg('ignored', () => ({ why: 'a click on the page itself' }));
      return;
    }
    // A click on a non-interactive area is kept only if it has no interactive ancestor.
    if (t.lowConfidence && hasInteractiveAncestor(el)) {
      dbg('ignored', () => ({ why: 'plain content inside a control: the control records it' }));
      return;
    }

    let fp: ElementFingerprint;
    const p = pending;
    pending = null;
    // A click on an ancestor of the pressed node (it was re-rendered) is linked only when released
    // where it was pressed: dragging off a button cancels the click (review of D61).
    const releasedAtPress = !p || p.x === undefined || p.y === undefined || Math.hypot((e as MouseEvent).clientX - p.x, (e as MouseEvent).clientY - p.y) <= PRESS_SLOP_PX;
    const linked = p && now() - p.time <= PENDING_LINK_MS && (p.el === el || path.includes(p.el) || (p.path.includes(el) && releasedAtPress));
    if (p && linked) fp = p.fp;
    else fp = t.fp ?? fpOf(el);
    const hint = (p && linked ? p.name : undefined) ?? t.name;

    if (isTextField(el) || isNativeSelect(el)) {
      flushFieldClick(el);
      // Clicking back into a field already typed into is not a new action.
      if (last && last.kind === 'input' && last.el === el) {
        dbg('ignored', () => ({ why: 'a click back into the field just typed into' }));
        return;
      }
      if (!fieldClick || fieldClick.el !== el) {
        fieldClick = { el, fp, time: now(), path };
        dbg('field.held', () => ({ why: 'a click into a field waits for typing or a change', tag }));
      }
      return;
    }
    flushFieldClick();

    if (isCheckLike(el)) {
      // A label click and the click it forwards to the control are one check step.
      if (sameTask.has(el)) {
        dbg('merge', () => ({ why: 'the click a label forwards to its control: one check step' }));
        return;
      }
      markSameTask(el);
      // Read the state after the app's own handlers ran (ARIA switches toggle in a click handler),
      // but keep the page and time of the click: a handler may also change the route (D67).
      const when = whenNow();
      const timer = setTimeout(() => {
        timers.delete(timer);
        add('check', el, fp, stepTitle('check', { name: nameFor(el, fp), checked: checkedState(el) }, lang), undefined, when);
      }, 0);
      timers.add(timer);
      return;
    }
    if (isCustomOption(el)) {
      add('select', el, fp, chooseOptionTitle(fp.text ?? fp.accessibleName ?? 'the option'));
      return;
    }
    // Only before a click that is recorded: a hover step alone would point at a menu for nothing.
    if (hasStrongSignal(fp)) maybeHover(el);
    add('click', el, fp, stepTitle('click', { name: hint ?? nameFor(el, fp) }, lang), flagsFor(el, t.lowConfidence));
  };

  const onInput = (e: Event) => {
    if (!trusted(e)) return;
    watchRoots(e.composedPath());
    const t = resolveTargetFromPath(e.composedPath());
    if (!t) return;
    const el = t.element;
    // Native selects: `input` is composed, so it also arrives from inside open shadow roots
    // (`change` does not). See D35.
    if (isNativeSelect(el)) return recordSelect(el);
    if (!isTextField(el)) return; // checkboxes and radios are handled by click/change
    // A reference typed into the Sheets Name Box is a cell step on Enter, not an input step (D206).
    if (isSheetsNameBox(el)) {
      if (fieldClick?.el === el) fieldClick = null;
      return;
    }
    typedAt = now();
    if (last && last.kind === 'input' && last.el === el) {
      if (fieldClick?.el === el) fieldClick = null;
      return; // many input events, one step
    }
    flushFieldClick(el);
    const fp = fieldClick && fieldClick.el === el ? fieldClick.fp : fpOf(el);
    fieldClick = null;
    add('input', el, fp, stepTitle('input', { name: nameFor(el, fp), sensitive: isSensitiveField(el) }, lang));
  };

  const recordSelect = (el: Element) => {
    const select = el as HTMLSelectElement;
    const option = safeLabel(select.selectedOptions[0]?.textContent);
    const fp = fieldClick && fieldClick.el === el ? fieldClick.fp : last?.el === el ? last.fp : fpOf(el);
    if (fieldClick?.el === el) fieldClick = null;
    flushFieldClick();
    const title = stepTitle('select', { name: nameFor(el, fp), ...(option ? { option } : {}) }, lang);
    if (last && last.kind === 'select' && last.el === el) {
      if (last.skipped) return;
      // Changing the same select again (arrow keys) updates the step.
      const step = makeStep('select', el, fp, title);
      step.id = last.id;
      last.time = now();
      dbg('merge', () => ({ why: 'the same select changed again: the step is updated', title: title.replace(/\*\*/g, '') }));
      opts.onTarget?.(last.id, el);
      opts.emit({ op: 'replace', stepId: last.id, step });
    } else add('select', el, fp, title);
  };

  // change and submit are not composed: listen on each open shadow root seen on an event path.
  const shadowRoots = new Set<ShadowRoot>();
  const watchRoots = (path: EventTarget[]) => {
    for (const n of path) {
      if (n instanceof ShadowRoot && !shadowRoots.has(n)) {
        shadowRoots.add(n);
        n.addEventListener('change', onChange, { capture: true });
        n.addEventListener('submit', onSubmit, { capture: true });
        observe(n);
      }
    }
  };

  const onChange = (e: Event) => {
    if (!trusted(e)) return;
    const el = e.composedPath()[0];
    if (!(el instanceof Element)) return;
    if (isNativeSelect(el)) return; // recorded from the input event
    if (isNativeCheck(el)) {
      if (sameTask.has(el)) {
        dbg('merge', () => ({ why: 'the change after the check click: one check step' }));
        return;
      }
      markSameTask(el);
      const fp = fpOf(el);
      add('check', el, fp, stepTitle('check', { name: nameFor(el, fp), checked: checkedState(el) }, lang));
    }
  };

  const onKeyDown = (e: Event) => {
    if (!trusted(e)) return;
    watchRoots(e.composedPath());
    const k = e as KeyboardEvent;
    if (k.key !== 'Enter') return;
    const t = resolveTargetFromPath(e.composedPath());
    if (t && isSheetsNameBox(t.element)) {
      if (fieldClick?.el === t.element) fieldClick = null;
      return recordCell('name box');
    }
    if (t && isTextField(t.element)) enter = { el: t.element, time: now() };
  };

  const onSubmit = (e: Event) => {
    if (!trusted(e)) return;
    const form = e.composedPath()[0];
    if (!(form instanceof HTMLFormElement)) return;
    const title = stepTitle('submit', {}, lang);
    if (last && !last.skipped && last.kind === 'click' && last.form === form && now() - last.time <= SUBMIT_MERGE_MS) {
      // A click on a submit button followed by submit is one submit step.
      const step = makeStep('submit', last.el, last.fp, title);
      step.id = last.id;
      last.kind = 'submit';
      dbg('merge', () => ({ why: 'a click on the submit button, then submit: one submit step' }));
      opts.onTarget?.(last.id, last.el);
      opts.emit({ op: 'replace', stepId: last.id, step });
      return;
    }
    if (enter && now() - enter.time <= SUBMIT_MERGE_MS && (enter.el as HTMLInputElement).form === form) {
      const button = form.querySelector('button:not([type]), button[type=submit], input[type=submit], input[type=image]');
      // A default button with nothing to find it by (an icon) would be skipped: use the field.
      const target = button && hasStrongSignal(fpOf(button)) ? button : enter.el;
      dbg('submit.enter', () => ({ why: target === button ? 'Enter in a field submits through the default button' : 'Enter in a field; the default button has nothing to find it by, so the field is the target (D47)' }));
      add('submit', target, fpOf(target), title);
      enter = null;
    }
  };

  const listeners: [string, (e: Event) => void][] = [
    ['pointerdown', onPointerDown],
    ['click', onClick],
    ['input', onInput],
    ['change', onChange],
    ['keydown', onKeyDown],
    ['submit', onSubmit],
    ['pointerover', onOver],
    ['scroll', onScroll],
    ['wheel', onScroll],
  ];
  for (const [type, fn] of listeners) doc.addEventListener(type, fn, { capture: true });

  return {
    stop() {
      for (const [type, fn] of listeners) doc.removeEventListener(type, fn, { capture: true });
      for (const r of shadowRoots) {
        r.removeEventListener('change', onChange, { capture: true });
        r.removeEventListener('submit', onSubmit, { capture: true });
      }
      shadowRoots.clear();
      observer?.disconnect();
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}
