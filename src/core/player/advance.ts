/**
 * Advance rules (SPEC: Player, "Advancing"): the learner progresses by doing the real action.
 *
 * | click    | a trusted click lands on the target, or on any tied candidate (instance 'any') |
 * | input    | change, or blur with a non-empty value, or Next                                 |
 * | select   | change on a native select; a click on the option for custom dropdowns          |
 * | check    | change on native inputs; a click on ARIA checkbox, radio or switch roles      |
 * | submit   | the form's submit event, or the page navigates away within 1.5 s of the click  |
 * | navigate | the URL matches the step's URL rule (handled by the controller)                |
 * | note     | Next                                                                            |
 */
import type { Step } from '../model/schema';
import { isNativeCheck, isNativeSelect } from '../recorder/classify';
import { tagOf } from '../fingerprint/dom';

export const SUBMIT_NAV_MS = 1500;

export interface AdvanceWatch {
  step: Step;
  /** The matched element and, for instance 'any', every tied candidate. */
  targets: Element[];
  doc?: Document;
  /** True for events inside Waymark's overlay. */
  isOwnEvent?: (path: EventTarget[]) => boolean;
  onAdvance: () => void;
  now?: () => number;
}

function hits(path: EventTarget[], targets: Element[]): Element | null {
  for (const t of targets) if (path.includes(t)) return t;
  return null;
}

function hasValue(el: Element): boolean {
  const v = (el as HTMLInputElement).value;
  if (typeof v === 'string') return v.length > 0; // checked for emptiness only, never stored
  return (el.textContent ?? '').trim().length > 0;
}

export function watchAdvance(w: AdvanceWatch): () => void {
  const doc = w.doc ?? document;
  const now = w.now ?? (() => Date.now());
  const own = w.isOwnEvent ?? (() => false);
  let fired = false;
  const advance = () => {
    if (fired) return;
    fired = true;
    w.onAdvance();
  };
  const listeners: [EventTarget, string, (e: Event) => void][] = [];
  const on = (target: EventTarget, type: string, fn: (e: Event) => void) => {
    target.addEventListener(type, fn, { capture: true });
    listeners.push([target, type, fn]);
  };
  const trusted = (e: Event) => e.isTrusted && !own(e.composedPath());
  const kind = w.step.kind;
  const primary = w.targets[0];

  if (kind === 'click' || (kind === 'select' && primary && !isNativeSelect(primary)) || (kind === 'check' && primary && !isNativeCheck(primary))) {
    on(doc, 'click', (e) => {
      if (trusted(e) && hits(e.composedPath(), w.targets)) advance();
    });
  }
  // change and submit are not composed: also listen on the open shadow roots the targets live in.
  const roots: EventTarget[] = [doc];
  for (const t of w.targets) {
    const r = t.getRootNode();
    if (r instanceof ShadowRoot && !roots.includes(r)) roots.push(r);
  }
  const onChange = (e: Event) => {
    if (trusted(e) && hits(e.composedPath(), w.targets)) advance();
  };
  if (kind === 'select' || kind === 'check' || kind === 'input') for (const r of roots) on(r, 'change', onChange);
  if (kind === 'input') {
    on(doc, 'focusout', (e) => {
      const t = hits(e.composedPath(), w.targets);
      if (trusted(e) && t && hasValue(t)) advance();
    });
  }
  if (kind === 'submit') {
    let clickedAt = -Infinity;
    on(doc, 'click', (e) => {
      if (trusted(e) && hits(e.composedPath(), w.targets)) clickedAt = now();
    });
    const forms = new Set<HTMLFormElement>();
    for (const t of w.targets) {
      const f = (t as HTMLButtonElement).form ?? t.closest('form');
      if (f) forms.add(f);
      if (tagOf(t) === 'form') forms.add(t as HTMLFormElement);
    }
    for (const r of roots) {
      on(r, 'submit', (e) => {
        if (e.isTrusted && forms.has(e.composedPath()[0] as HTMLFormElement)) advance();
      });
    }
    // "The page navigates away within 1.5 s of the click": only a real cross-document
    // navigation counts (not pushState or a hash change, and not a cancelled beforeunload).
    const leaving = () => {
      if (now() - clickedAt <= SUBMIT_NAV_MS) advance();
    };
    const win = doc.defaultView;
    if (win) {
      on(win, 'pagehide', leaving);
      const nav = (win as Window & { navigation?: EventTarget }).navigation;
      if (nav)
        on(nav, 'navigate', (e) => {
          const dest = (e as Event & { destination?: { sameDocument?: boolean } }).destination;
          if (dest && dest.sameDocument === false) leaving();
        });
    }
  }
  return () => {
    for (const [t, type, fn] of listeners) t.removeEventListener(type, fn, { capture: true });
  };
}
