/**
 * Recorder (SPEC: Recorder): turns raw browser events into a short list of human-sized steps.
 * Runs in every granted frame. Never stores what the author types.
 *
 * Emits operations rather than final steps, because some merges are only known later:
 * a click on a submit button becomes a submit step when the form's submit event follows.
 */
import type { ElementFingerprint, Step, StepFlag } from '../model/schema';
import type { ProfileOptions } from '../model/profile';
import { newId } from '../model/ids';
import { buildFingerprint } from '../fingerprint/build';
import { hasStrongSignal } from '../matcher/signals';
import { composedParent, isInteractive, resolveTargetFromPath, tagOf } from '../fingerprint/dom';
import { safeLabel } from '../fingerprint/filters';
import { chooseOptionTitle, roleWord, stepTitle } from '../text/templates';
import { stepUrlRule } from '../url/url';
import { checkedState, isCheckLike, isCustomOption, isNativeCheck, isNativeSelect, isSensitiveField, isTextField, submitForm } from './classify';

/** `at`: when the action happened (ms since epoch), for the navigation rule (D67). */
export type RecorderOp = { op: 'add'; step: Step; at?: number } | { op: 'replace'; stepId: string; step: Step; at?: number };

export interface RecorderOptions {
  doc?: Document;
  emit: (op: RecorderOp) => void;
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
  const makeStep = (kind: Step['kind'], el: Element, fp: ElementFingerprint, title: string, flags?: StepFlag[], when?: When): Step => {
    const step: Step = { id: newId(), kind, title, url: stepUrlRule(when?.url ?? doc.URL, opts.profile), target: fp, advance: 'action' };
    if (flags) step.flags = flags;
    return step;
  };

  const add = (kind: Step['kind'], el: Element, fp: ElementFingerprint, title: string, flags?: StepFlag[], when: When = whenNow()) => {
    if (!hasStrongSignal(fp)) {
      opts.onSkip?.('unfindable');
      last = { id: '', kind, el, time: now(), form: null, fp, skipped: true };
      return null;
    }
    const step = makeStep(kind, el, fp, title, flags, when);
    last = { id: step.id, kind, el, time: now(), form: kind === 'click' || kind === 'submit' ? submitForm(el) : null, fp };
    opts.emit({ op: 'add', step, at: when.at });
    return step;
  };

  /** A click into a field that was never typed into still counts as a click (date pickers, etc.). */
  const flushFieldClick = (except?: Element) => {
    const f = fieldClick;
    if (!f || f.el === except) return;
    fieldClick = null;
    if (isTextField(f.el)) add('click', f.el, f.fp, stepTitle('click', { name: nameFor(f.el, f.fp) }, lang));
  };

  const trusted = (e: Event) => e.isTrusted && !isOwn(e.composedPath());

  const onPointerDown = (e: Event) => {
    if (!trusted(e)) return;
    const path = e.composedPath();
    watchRoots(path);
    const t = resolveTargetFromPath(path);
    if (!t || t.lowConfidence) {
      pending = null;
      return;
    }
    const m = e as PointerEvent;
    pending = { el: t.element, fp: fpOf(t.element), time: now(), path, x: m.clientX, y: m.clientY };
  };

  const hasInteractiveAncestor = (el: Element) => {
    for (let p = composedParent(el); p; p = composedParent(p)) if (isInteractive(p)) return true;
    return false;
  };

  const onClick = (e: Event) => {
    if (!trusted(e)) return;
    if ((e as MouseEvent).detail > 1) return; // a double-click is one click step
    const path = e.composedPath();
    watchRoots(path);
    let t = resolveTargetFromPath(path);
    if (!t) return;
    // Pressed on a control that opened something over itself (MUI's select opens on mousedown
    // behind a full-page backdrop): the mouseup lands on the backdrop, so the click goes to the
    // common ancestor of the two. That ancestor is on the pressed control's path (D61).
    const pressed = pending;
    const m = e as MouseEvent;
    const atPress = !!pressed && pressed.x !== undefined && pressed.y !== undefined && Math.hypot(m.clientX - pressed.x, m.clientY - pressed.y) <= PRESS_SLOP_PX; // not a drag-off cancel
    if (t.lowConfidence && pressed && atPress && now() - pressed.time <= PENDING_LINK_MS && pressed.path.includes(t.element) && !path.includes(pressed.el)) {
      t = { element: pressed.el, lowConfidence: false };
    }
    const el = t.element;
    const tag = tagOf(el);
    if (tag === 'html' || tag === 'body') return;
    // A click on a non-interactive area is kept only if it has no interactive ancestor.
    if (t.lowConfidence && hasInteractiveAncestor(el)) return;

    let fp: ElementFingerprint;
    const p = pending;
    pending = null;
    // A click on an ancestor of the pressed node (it was re-rendered) is linked only when released
    // where it was pressed: dragging off a button cancels the click (review of D61).
    const releasedAtPress = !p || p.x === undefined || p.y === undefined || Math.hypot((e as MouseEvent).clientX - p.x, (e as MouseEvent).clientY - p.y) <= PRESS_SLOP_PX;
    const linked = p && now() - p.time <= PENDING_LINK_MS && (p.el === el || path.includes(p.el) || (p.path.includes(el) && releasedAtPress));
    if (p && linked) fp = p.fp;
    else fp = fpOf(el);

    if (isTextField(el) || isNativeSelect(el)) {
      flushFieldClick(el);
      // Clicking back into a field already typed into is not a new action.
      if (last && last.kind === 'input' && last.el === el) return;
      if (!fieldClick || fieldClick.el !== el) fieldClick = { el, fp, time: now(), path };
      return;
    }
    flushFieldClick();

    if (isCheckLike(el)) {
      // A label click and the click it forwards to the control are one check step.
      if (sameTask.has(el)) return;
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
    add('click', el, fp, stepTitle('click', { name: nameFor(el, fp) }, lang), flagsFor(el, t.lowConfidence));
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
      }
    }
  };

  const onChange = (e: Event) => {
    if (!trusted(e)) return;
    const el = e.composedPath()[0];
    if (!(el instanceof Element)) return;
    if (isNativeSelect(el)) return; // recorded from the input event
    if (isNativeCheck(el)) {
      if (sameTask.has(el)) return;
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
      opts.emit({ op: 'replace', stepId: last.id, step });
      return;
    }
    if (enter && now() - enter.time <= SUBMIT_MERGE_MS && (enter.el as HTMLInputElement).form === form) {
      const button = form.querySelector('button:not([type]), button[type=submit], input[type=submit], input[type=image]');
      // A default button with nothing to find it by (an icon) would be skipped: use the field.
      const target = button && hasStrongSignal(fpOf(button)) ? button : enter.el;
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
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}
