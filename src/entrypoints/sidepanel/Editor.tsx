/**
 * Guide editor (SPEC: User flows, Edit): edit each step's title, note, voice text, advance mode
 * and whether it is optional; Test step; Re-pick element; reorder, delete or insert steps.
 * Save bumps the guide version.
 */
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { ElementFingerprint, Guide, Step } from '../../core/model/schema';
import { newId } from '../../core/model/ids';
import { voiceTextFor } from '../../core/voice/voice';
import type { TestResult } from '../../background/editor';
import { Markdown } from './Markdown';
import { Icon } from '../../ui/Icon';
import { FLAG_HELP, FlagNotes, KIND } from './steps';
import { parseTags } from '../../core/discovery/tags';
import { UNDO_MS } from '../../core/storage/trash';
import { dismissScope, showToast, ToastSlot } from './Toast';
import { useFlipList } from '../../ui/useMotion';
import { dropIndex, edgeScroll, moveItem } from '../../core/editor/reorder';
import { normalizeRef } from '../../core/sheets';
import { stepTitle } from '../../core/text/templates';
import { DEFAULT_SHADE, withGuideShade } from '../../core/player/shade';
import { SHADE_LABEL, SHADE_NAME } from '../../ui/shadeCopy';
import type { ShotsStatus } from '../../core/messaging/protocol';
import { SHOT_HINT_PANEL, ShotsSwitch } from './Shots';
import { reasonText, type Reason } from '../../core/stats/plays';
import { targetHash } from '../../core/shots/lifecycle';

const draft = signal<Guide | null>(null);
const dirty = signal(false);
const status = signal<string | null>(null);
const error = signal<string | null>(null);
const tests = signal<Record<string, TestResult | 'running'>>({});
const picking = signal<string | null>(null);
const suggested = signal<Record<string, string>>({});
const saving = signal(false);
/** The guide's screenshot setting and which steps have one (D180, D187); not part of the draft. */
const shots = signal<ShotsStatus | null>(null);

/** Steps that may break, from plays on this device (D211): reasons per step, for the element they were about. */
const plays = signal<Record<string, { t: string; reasons: Reason[] }>>({});

async function loadPlays(guideId: string) {
  try {
    const r = await send('stats.guide', { guideId });
    if (draft.value?.id === guideId || !draft.value) plays.value = r?.steps ?? {};
  } catch {
    plays.value = {};
  }
}

/** The step's reasons, while the draft still has the element they were about (a Re-pick clears them at once). */
function playReasons(s: Step): Reason[] {
  const p = plays.value[s.id];
  return p && s.target && p.t === targetHash(s.target) ? p.reasons : [];
}

async function loadShots(guideId: string) {
  try {
    const s = await send('shots.get', { guideId });
    if (draft.value?.id === guideId || !draft.value) shots.value = s;
  } catch {
    shots.value = null;
  }
}
/** revisionId of the copy the draft was loaded from; Save is refused if it changed elsewhere. */
const base = signal<string | null>(null);
/** The tags field as typed ("a, b"); the draft holds the parsed list. */
const tagsText = signal('');
/** Steps shown open (D125): steps start folded to one line, except those with a warning. */
const openSteps = signal<Set<string>>(new Set());
/** Steps whose "More options" (voice text, when to move on, optional, duplicate, note after) are open. */
const moreSteps = signal<Set<string>>(new Set());

function toggleIn(set: typeof openSteps, id: string, on?: boolean) {
  const next = new Set(set.value);
  if (on ?? !next.has(id)) next.add(id);
  else next.delete(id);
  set.value = next;
}

/** Which steps start open: those the recorder flagged, so the author sees what needs attention. */
export function initiallyOpen(steps: Step[]): Set<string> {
  return new Set(steps.filter((s) => s.flags?.length).map((s) => s.id));
}
let pickTimer: ReturnType<typeof setTimeout> | undefined;

function endPicking() {
  picking.value = null;
  clearTimeout(pickTimer);
}

function setSteps(fn: (steps: Step[]) => Step[]) {
  if (!draft.value) return;
  draft.value = { ...draft.value, steps: fn(draft.value.steps) };
  dirty.value = true;
}

function patchStep(id: string, patch: Partial<Step>) {
  setSteps((steps) =>
    steps.map((s) => {
      if (s.id !== id) return s;
      const next: Step = { ...s, ...patch };
      const optional: (keyof Step)[] = ['note', 'voiceText', 'optional', 'placement', 'flags'];
      for (const k of Object.keys(patch) as (keyof Step)[]) if (optional.includes(k) && (patch[k] === undefined || patch[k] === '')) delete next[k];
      return next;
    }),
  );
}

/**
 * The step whose Move up / Move down button or drag handle had focus: reordering re-inserts its
 * row, which drops focus to the page, so the control gets it back after the render (D130, D205).
 */
let refocusMove: { id: string; control: 'up' | 'down' | 'drag' } | null = null;

/** Moves the step at `index` to `to` (clamped). `control`: what gets focus back if it had it. */
function moveTo(index: number, to: number, control: 'up' | 'down' | 'drag') {
  const steps = draft.value?.steps ?? [];
  // Nothing moves (Esc without a move, Home at the top): the draft stays unchanged, Save stays off.
  if (index < 0 || index >= steps.length || Math.max(0, Math.min(steps.length - 1, to)) === index) return;
  const active = document.activeElement;
  const id = steps[index]?.id;
  refocusMove = id && active?.closest(`[data-flip="${CSS.escape(id)}"]`) ? { id, control } : null;
  setSteps((steps) => moveItem(steps, index, to) as Step[]);
}

function move(index: number, by: number) {
  moveTo(index, index + by, by < 0 ? 'up' : 'down');
}

/** Keyboard reordering (D205): the step picked up with Space on its handle, and where it was. */
const lifted = signal<{ id: string; from: number } | null>(null);
/** What a screen reader hears about reordering. */
const reorderNote = signal('');
/** The dragged row keeps its offset until the new order is rendered, so it glides from where it was dropped. */
let dropped: HTMLElement | null = null;
/**
 * Ends the pointer drag in progress, if any, without moving anything. A drag lives outside
 * Preact's state (its classes and offset are set on the DOM, so a drag re-renders nothing), and
 * this is how the editor ends one when it goes away mid-drag.
 */
let cancelDrag: (() => void) | null = null;

function scrollerOf(el: Element): Element {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement ?? document.documentElement;
}

function clearDragStyle(row: HTMLElement) {
  row.style.transform = '';
  row.classList.remove('dragging');
}

/** The visible part of the scrolling area: below the panel's sticky header, above the editor's sticky Save bar. */
function visibleArea(scroller: Element, isPage: boolean): { top: number; bottom: number } {
  const box = isPage ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
  let { top, bottom } = box;
  const header = document.querySelector('.app-header')?.getBoundingClientRect();
  const bar = document.querySelector('.editor-bar')?.getBoundingClientRect();
  if (header && header.bottom > top && header.bottom < bottom) top = header.bottom;
  if (bar && bar.top < bottom && bar.top > top) bottom = bar.top;
  return { top, bottom };
}

/** A drag from a step's handle (D205): the card follows the pointer, a line shows where it lands, the panel scrolls near its edges, Esc cancels. */
function startDrag(e: PointerEvent, list: HTMLElement | null, index: number, id: string, total: number) {
  if (e.button !== 0 || !list || cancelDrag) return; // one drag at a time
  const handle = e.currentTarget as HTMLElement;
  const row = handle.closest<HTMLElement>('[data-flip]');
  if (!row) return;
  e.preventDefault(); // no text selection
  handle.focus({ preventScroll: true });
  lifted.value = null;
  try {
    handle.setPointerCapture(e.pointerId);
  } catch {
    // a synthetic or already released pointer: moves still reach the handle while it is pressed
  }
  const scroller = scrollerOf(list);
  const isPage = scroller === document.scrollingElement || scroller === document.documentElement;
  const top0 = scroller.scrollTop;
  const rows = Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-flip]'));
  const spans = rows.map((r) => {
    const b = r.getBoundingClientRect();
    return { top: b.top + top0, height: b.height };
  });
  const startY = e.clientY;
  let y = startY;
  let started = false;
  let raf = 0;
  let to = index;
  let marked: HTMLElement | null = null;
  // The line: above the card the step takes the place of when it goes up, below it when it goes down.
  const mark = () => {
    const target = to === index ? null : (rows[to] ?? null);
    const cls = to < index ? 'drop-before' : 'drop-after';
    if (marked && (marked !== target || !marked.classList.contains(cls))) marked.classList.remove('drop-before', 'drop-after');
    marked = target;
    marked?.classList.add(cls);
  };
  const place = () => {
    if (!started) return;
    const dy = y + scroller.scrollTop - (startY + top0);
    row.style.transform = `translateY(${Math.round(dy)}px)`;
    const next = dropIndex(spans, index, dy);
    if (next !== to) {
      to = next;
      mark();
    }
  };
  const tick = () => {
    raf = 0;
    const a = visibleArea(scroller, isPage);
    const by = edgeScroll(y, a.top, a.bottom);
    // Only toward the edge the pointer went to: a handle grabbed near the top doesn't scroll at once.
    if (!by || (by < 0 && y >= startY) || (by > 0 && y <= startY)) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += by;
    if (scroller.scrollTop === before) return; // at the end
    place();
    raf = requestAnimationFrame(tick);
  };
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    y = ev.clientY;
    if (!started) {
      if (Math.abs(y - startY) < 4) return;
      started = true;
      row.classList.add('dragging');
      list.classList.add('is-dragging');
    }
    place();
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const scrollTarget: EventTarget = isPage ? window : scroller;
  const finish = (commit: boolean) => {
    cancelDrag = null;
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onCancel);
    handle.removeEventListener('lostpointercapture', onCancel);
    scrollTarget.removeEventListener('scroll', place);
    window.removeEventListener('keydown', onKey, true);
    cancelAnimationFrame(raf);
    marked?.classList.remove('drop-before', 'drop-after');
    list.classList.remove('is-dragging');
    if (commit && started && to !== index && row.isConnected) {
      dropped = row;
      reorderNote.value = `Step moved to position ${to + 1} of ${total}.`;
      moveTo(index, to, 'drag');
    } else {
      clearDragStyle(row);
      if (started) reorderNote.value = `Move cancelled. Step ${index + 1} stays where it was.`;
    }
  };
  const onUp = (ev: PointerEvent) => ev.pointerId === e.pointerId && finish(true);
  // A cancelled pointer, or capture lost (the handle left the page): nothing moves.
  const onCancel = (ev: PointerEvent) => ev.pointerId === e.pointerId && finish(false);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
  };
  cancelDrag = () => finish(false);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onCancel);
  handle.addEventListener('lostpointercapture', onCancel);
  scrollTarget.addEventListener('scroll', place, { passive: true }); // a wheel turned mid-drag
  window.addEventListener('keydown', onKey, true);
}

/** The drag handle by keyboard (D205): Space or Enter picks the step up and drops it, the arrow keys move it, Esc puts it back. */
function onHandleKey(e: KeyboardEvent, index: number, id: string, total: number) {
  const l = lifted.value;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (e.repeat) return; // a held key doesn't pick up and drop over and over
    if (l?.id === id) {
      lifted.value = null;
      reorderNote.value = `Step dropped at position ${index + 1} of ${total}.`;
    } else {
      lifted.value = { id, from: index };
      reorderNote.value = `Step ${index + 1} of ${total} picked up. Use the up and down arrow keys to move it, Space to drop it, Escape to cancel.`;
    }
    return;
  }
  if (l?.id !== id) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const to = index + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= total) return;
    moveTo(index, to, 'drag');
    reorderNote.value = `Position ${to + 1} of ${total}.`;
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    const to = e.key === 'Home' ? 0 : total - 1;
    moveTo(index, to, 'drag');
    reorderNote.value = `Position ${to + 1} of ${total}.`;
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    lifted.value = null;
    moveTo(index, l.from, 'drag');
    reorderNote.value = `Move cancelled. Step back at position ${l.from + 1} of ${total}.`;
  } else if (e.key === 'Tab') {
    lifted.value = null;
    reorderNote.value = `Step dropped at position ${index + 1} of ${total}.`;
  }
}

/**
 * Focus left a lifted step's handle (a click elsewhere): the step is dropped where it is, so a
 * later Esc can't put it back at a place that has changed since. A move re-inserts the row, which
 * blurs the handle for a moment: that blur (refocusMove still pending) doesn't count.
 */
function onHandleBlur(e: FocusEvent, index: number, id: string, total: number) {
  if (lifted.value?.id !== id || refocusMove) return;
  const row = (e.currentTarget as HTMLElement).closest('[data-flip]');
  if (row && e.relatedTarget instanceof Node && row.contains(e.relatedTarget)) return;
  lifted.value = null;
  reorderNote.value = `Step dropped at position ${index + 1} of ${total}.`;
}

/** A copy of a step right after it, with a new id (D100). */
export function duplicateStepIn(steps: Step[], index: number): Step[] {
  const s = steps[index];
  if (!s) return steps;
  const copy = steps.slice();
  copy.splice(index + 1, 0, { ...structuredClone(s), id: newId() });
  return copy;
}

/** Puts a deleted step back where it was (or at the end, if the list got shorter). */
export function restoreStepIn(steps: Step[], step: Step, index: number): Step[] {
  if (steps.some((x) => x.id === step.id)) return steps;
  const copy = steps.slice();
  copy.splice(Math.min(index, copy.length), 0, step);
  return copy;
}

/** Deletes a step from the draft; the toast's Undo puts it back until the draft is saved or the editor closes. */
function deleteStep(index: number) {
  const g = draft.value;
  const step = g?.steps[index];
  if (!g || !step) return;
  const guideId = g.id;
  setSteps((steps) => steps.filter((x) => x.id !== step.id));
  showToast({
    scope: 'editor',
    text: `Deleted step ${index + 1}.`,
    until: Date.now() + UNDO_MS,
    focus: true,
    testid: 'step-undo-toast',
    fallbackFocus: () => document.getElementById('steps-heading'),
    action: {
      label: 'Undo',
      run: () => {
        if (draft.value?.id !== guideId) return;
        setSteps((steps) => restoreStepIn(steps, step, index));
      },
    },
  });
}

/**
 * The picker for a new step after the step `after` (its id; '' for the end) (D202): `picking`
 * holds `new:<after>` meanwhile. An id, not an index: steps moved or deleted while the pick waits
 * must not put the new step somewhere else (review of D202).
 */
const newMark = (after: string) => `new:${after}`;
function addByPick(tabId: number, after: string, origins: string[]) {
  const mark = newMark(after);
  if (picking.value === mark) {
    void attempt(() => send('pick.cancel', { tabId }));
    endPicking();
    return;
  }
  picking.value = mark;
  clearTimeout(pickTimer);
  pickTimer = setTimeout(endPicking, 120_000); // the service worker stops accepting picks then
  void attempt(() => send('pick.start', { tabId, origins })).then((r) => {
    if (!r) endPicking();
  });
}

/** A picked element as a new click step after the step `after` (the end when '' or gone) (D202). */
function insertPicked(after: string, r: { target: ElementFingerprint; title?: string; url?: Step['url'] }) {
  setSteps((steps) => {
    const i = after ? steps.findIndex((s) => s.id === after) : -1;
    const at = i >= 0 ? i + 1 : steps.length;
    const ref = steps[at - 1] ?? steps[0];
    const step: Step = { id: newId(), kind: 'click', title: r.title || 'Click the element', url: r.url ?? ref?.url ?? { kind: 'prefix', value: '/' }, target: r.target, advance: 'action' };
    toggleIn(openSteps, step.id, true);
    tests.value = { ...tests.value, [step.id]: { found: true, score: 100, margin: 100, matched: ['picked'], fragile: false } };
    const copy = steps.slice();
    copy.splice(Math.min(at, copy.length), 0, step);
    return copy;
  });
}

/** Record steps into the saved guide before index `at` (D202): Stop puts them there. */
function recordInto(tabId: number, guideId: string, at: number) {
  void attempt(() => send('rec.start', { tabId, title: '', insertInto: { guideId, at } }));
}

function insertNote(after: number) {
  setSteps((steps) => {
    const ref = steps[after] ?? steps[steps.length - 1];
    const note: Step = { id: newId(), kind: 'note', title: 'New note', url: ref?.url ?? { kind: 'prefix', value: '/' }, advance: 'next' };
    toggleIn(openSteps, note.id, true);
    const copy = steps.slice();
    copy.splice(after + 1, 0, note);
    return copy;
  });
}

async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    error.value = null;
    return await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return undefined;
  }
}

/** True while the editor holds edits that are not saved (the recording shortcut must not drop them, D105). */
export function editorHasUnsavedEdits(): boolean {
  return dirty.value && !!draft.value;
}

/**
 * Add a real step (D202, #89): pick it on the page (a click step, into the draft), or record steps
 * there (any kind; Stop saves them into the guide, so unsaved edits must be saved first).
 */
function AddStepButtons({ after, testid, label, g, tabId, readOnly }: { after: string; testid: string; label: string; g: Guide; tabId: number | null; readOnly: boolean }) {
  const onSite = tabId !== null;
  const picking_ = picking.value === newMark(after);
  // Recording needs the place now: the draft has no unsaved edits then, so the saved guide matches.
  const at = after ? g.steps.findIndex((s) => s.id === after) + 1 : g.steps.length;
  return (
    <>
      <button
        type="button"
        class="ghost sm"
        data-testid={`${testid}-pick`}
        disabled={readOnly || !onSite || (!!picking.value && !picking_)}
        title="Click the element on the page; it becomes a new click step here"
        onClick={() => addByPick(tabId!, after, g.appOrigins)}
      >
        <Icon name={picking_ ? 'close' : 'crosshair'} />
        {picking_ ? 'Cancel picking' : `Add a step ${label}`}
      </button>
      <button
        type="button"
        class="ghost sm"
        data-testid={`${testid}-record`}
        disabled={readOnly || !onSite || dirty.value || !!picking.value}
        title={dirty.value ? 'Save your changes first: the recorded steps are saved into the guide' : 'Record clicks, fields and choices on the page; Stop puts them here'}
        onClick={() => recordInto(tabId!, g.id, at)}
      >
        <Icon name="play" />
        Record steps {label}
      </button>
    </>
  );
}

/**
 * The cell of a Sheets cell step (D206), like B8 or B5:D9. A title still made from the template
 * follows the new cell; a title the author wrote stays.
 */
function CellField({ step, index, readOnly }: { step: Step; index: number; readOnly: boolean }) {
  const cell = step.cell!;
  // Kept here: the field is keyed by the step and its cell, so an undo or another cell starts clean.
  const [error, setError] = useState<string | null>(null);
  const commit = (raw: string) => {
    const ref = normalizeRef(raw);
    if (!ref) {
      setError('Use a cell like B8, or a range like B5:D9.');
      return;
    }
    setError(null);
    if (ref === cell.ref) return;
    const sheet = cell.sheet ? { sheet: cell.sheet } : {};
    const fromTemplate = step.title === stepTitle('cell', { name: cell.ref, ...sheet });
    patchStep(step.id, { cell: { ...cell, ref }, ...(fromTemplate ? { title: stepTitle('cell', { name: ref, ...sheet }) } : {}) });
  };
  return (
    <label class="field">
      <span class="label">
        Cell <span class="hint">· like B8, or B5:D9 for a range{cell.sheet ? `, on the sheet “${cell.sheet}”` : ''}</span>
      </span>
      <input
        data-testid={`step-${index}-cell`}
        value={cell.ref}
        disabled={readOnly}
        spellcheck={false}
        autocomplete="off"
        aria-invalid={!!error}
        aria-describedby={error ? `cell-error-${step.id}` : undefined}
        onChange={(e) => commit((e.target as HTMLInputElement).value)}
      />
      {error && (
        <span class="field-error" id={`cell-error-${step.id}`} role="alert" data-testid={`step-${index}-cell-error`}>
          {error}
        </span>
      )}
    </label>
  );
}

export function Editor({ guideId, tabId, onClose }: { guideId: string; tabId: number | null; onClose: () => void }) {
  const stepFlip = useFlipList<HTMLOListElement>(draft.value?.steps.map((s) => s.id) ?? []);
  useLayoutEffect(() => {
    // The dropped row glides from where it was let go (its offset stayed for the measurement).
    if (dropped) {
      clearDragStyle(dropped);
      dropped = null;
    }
    const r = refocusMove;
    if (!r) return;
    refocusMove = null;
    const row = stepFlip.ref.current?.querySelector(`[data-flip="${CSS.escape(r.id)}"]`);
    if (!row || row.contains(document.activeElement)) return;
    if (r.control === 'drag') {
      row.querySelector<HTMLButtonElement>('[data-testid$="-drag"]')?.focus();
      return;
    }
    // At the top or bottom the pressed button is now disabled: the other one takes focus.
    const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>('[data-testid$="-up"], [data-testid$="-down"]'));
    (buttons.find((b) => b.dataset.testid!.endsWith(`-${r.control}`) && !b.disabled) ?? buttons.find((b) => !b.disabled))?.focus();
  });
  // A drag or a lifted step never outlives the editor (it can close mid-drag: a recording started by shortcut).
  useEffect(
    () => () => {
      cancelDrag?.();
      lifted.value = null;
    },
    [],
  );
  // Results from a play while the editor is open show at once (review of D211), for a kept draft too.
  useEffect(() => {
    void loadPlays(guideId);
    const statsKey = `stats:${guideId}`;
    const onStats = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && statsKey in changes) void loadPlays(guideId);
    };
    chrome.storage.onChanged.addListener(onStats);
    return () => chrome.storage.onChanged.removeListener(onStats);
  }, [guideId]);
  useEffect(() => {
    // Back from a recording started with the shortcut: the unsaved draft of this guide is kept.
    lifted.value = null;
    reorderNote.value = '';
    cancelDrag?.();
    if (draft.value?.id === guideId && dirty.value) return () => dismissScope('editor');
    draft.value = null;
    dirty.value = false;
    status.value = null;
    tests.value = {};
    shots.value = null;
    void loadShots(guideId);
    void attempt(async () => {
      const g = await send('guide.get', { id: guideId });
      draft.value = g;
      openSteps.value = initiallyOpen(g.steps);
      moreSteps.value = new Set();
      base.value = g.revisionId;
      tagsText.value = g.tags.join(', ');
    });
    // A step's Undo belongs to this draft: it goes when the editor closes.
    return () => dismissScope('editor');
  }, [guideId]);

  // Re-pick results arrive through session storage (the panel is a trusted context).
  useEffect(() => {
    if (tabId === null) return;
    const key = `pickResult:${tabId}`;
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session' || !(key in changes)) return;
      const r = changes[key]!.newValue as { target?: ElementFingerprint; title?: string; url?: Step['url']; cancelled?: boolean } | undefined;
      const stepId = picking.value;
      if (!r) return;
      void chrome.storage.session.remove(key);
      if (!stepId) return;
      endPicking();
      if (r.cancelled || !r.target) return;
      if (stepId.startsWith('new:')) {
        insertPicked(stepId.slice(4), { target: r.target, ...(r.title ? { title: r.title } : {}), ...(r.url ? { url: r.url } : {}) });
        return;
      }
      // The explicitly chosen element replaces the target; recorder warnings no longer apply.
      patchStep(stepId, { target: r.target, flags: undefined, ...(r.url ? { url: r.url } : {}) });
      if (r.title) suggested.value = { ...suggested.value, [stepId]: r.title };
      tests.value = { ...tests.value, [stepId]: { found: true, score: 100, margin: 100, matched: ['re-picked'], fragile: false } };
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      // Leaving the editor or switching tabs ends a pick, so the page stops swallowing clicks.
      if (picking.value) void send('pick.cancel', { tabId }).catch(() => undefined);
      endPicking();
    };
  }, [tabId]);

  const g = draft.value;
  if (!g)
    return (
      <section class="card">
        {error.value ? (
          <p class="alert" role="alert">
            <Icon name="error" />
            {error.value}
          </p>
        ) : (
          <p class="status-text">Loading…</p>
        )}
      </section>
    );
  const readOnly = g.source === 'library';
  // Counted on the current steps: a deleted step's id may still be in the set.
  const allOpen = g.steps.length > 0 && g.steps.every((x) => openSteps.value.has(x.id));

  const save = () => {
    const sent = draft.value!;
    const missing = sent.steps.findIndex((x) => !x.title.trim());
    if (missing >= 0) {
      error.value = `Step ${missing + 1} needs a title.`;
      return;
    }
    saving.value = true;
    void attempt(async () => {
      const saved = await send('guide.save', { guide: sent, baseRevisionId: base.value ?? sent.revisionId });
      base.value = saved.revisionId;
      if (draft.value === sent) {
        draft.value = saved;
        dirty.value = false;
      } else {
        // Edits typed during the save stay; they will go out with the next Save.
        draft.value = { ...draft.value!, version: saved.version, revisionId: saved.revisionId, updatedAt: saved.updatedAt };
      }
      status.value = `Saved (version ${saved.version}).`;
      void loadPlays(saved.id);
      // Deleted steps and re-picked elements lost their screenshots.
      if (shots.value?.on) void loadShots(saved.id);
      // The saved copy no longer has the step: its Undo would only make the draft dirty again.
      dismissScope('editor');
    }).finally(() => (saving.value = false));
  };

  return (
    <section class="card editor" aria-labelledby="editor-heading">
      <h2 id="editor-heading">{readOnly ? 'Team guide' : 'Edit guide'}</h2>
      <label class="field">
        <span class="label">Guide title</span>
        <input
          data-testid="guide-title-edit"
          value={g.title}
          disabled={readOnly}
          onInput={(e) => {
            draft.value = { ...g, title: (e.target as HTMLInputElement).value };
            dirty.value = true;
          }}
        />
      </label>
      <label class="field">
        <span class="label">
          Tags <span class="hint">· optional, separated by commas. Use them to filter your list.</span>
        </span>
        <input
          data-testid="guide-tags"
          value={tagsText.value}
          disabled={readOnly}
          placeholder="e.g. billing, onboarding"
          onInput={(e) => {
            tagsText.value = (e.target as HTMLInputElement).value;
            draft.value = { ...draft.value!, tags: parseTags(tagsText.value) };
            dirty.value = true;
          }}
        />
      </label>
      <label class="field">
        <span class="label">
          {SHADE_NAME} <span class="hint">· for this guide. Learners who picked a shade in their Settings see theirs.</span>
        </span>
        <select
          data-testid="guide-shade"
          value={g.shade === 'lighter' || g.shade === 'darker' ? g.shade : ''}
          disabled={readOnly}
          onChange={(e) => {
            draft.value = withGuideShade(draft.value!, (e.target as HTMLSelectElement).value);
            dirty.value = true;
          }}
        >
          <option value="">Default ({SHADE_LABEL[DEFAULT_SHADE]})</option>
          <option value="lighter">{SHADE_LABEL.lighter}</option>
          <option value="darker">{SHADE_LABEL.darker}</option>
        </select>
      </label>
      {!readOnly && (
        <ShotsSwitch
          testid="guide-shots"
          on={!!shots.value?.on}
          hint={
            shots.value?.on
              ? `${shots.value.stepIds.length} of ${g.steps.filter((x) => x.target).length} steps have one. Turning this off deletes them.`
              : 'Off by default. Used only in the printable how-to; never in guide files or the team library.'
          }
          onChange={(on) => void attempt(async () => (shots.value = await send('shots.set', { guideId: g.id, on })))}
        />
      )}
      <div class="row">
        <span class="badge">
          {g.steps.length} {g.steps.length === 1 ? 'step' : 'steps'}
        </span>
        {readOnly && <span class="badge accent">Team guide · read-only</span>}
        {dirty.value && <span class="badge warn">Unsaved changes</span>}
      </div>
      {readOnly && <p class="small muted">Team guides are read-only. Use Duplicate in the list to edit your own copy.</p>}
      <div class="row steps-head">
        <h3 class="section-label" id="steps-heading" tabIndex={-1}>
          <Icon name="steps" />
          Steps
        </h3>
        <button
          type="button"
          class="ghost sm push"
          data-testid="toggle-all-steps"
          onClick={() => (allOpen ? (openSteps.value = new Set()) : (openSteps.value = new Set(g.steps.map((x) => x.id))))}
        >
          {allOpen ? 'Fold all steps' : 'Open all steps'}
        </button>
      </div>
      <p class="hint">Open a step to change its text, test it or point it at another element. Drag a step by its handle, or use the arrows, to reorder.</p>
      <p class="visually-hidden" id="reorder-help">
        Drag to move the step, or press Space or Enter to pick it up, the up and down arrow keys to move it, and Space or Enter again to drop it. Escape cancels.
      </p>
      <p class="visually-hidden" role="status" data-testid="reorder-status">
        {reorderNote.value}
      </p>
      <ol class="edit-steps" aria-label="Steps" ref={stepFlip.ref}>
        {g.steps.map((s, i) => {
          const t = tests.value[s.id];
          const canTarget = s.kind !== 'note' && s.kind !== 'navigate';
          // Any step with an element can have one, in frames too (D191).
          const noShot = !!shots.value?.on && canTarget && !!s.target && !shots.value.stepIds.includes(s.id);
          // A 0.5.0 close-up: it still prints, and Capture again takes the whole page (D196).
          const oldShot = !!shots.value?.on && canTarget && !!s.target && !!shots.value.old?.includes(s.id);
          const runTest = () => {
            tests.value = { ...tests.value, [s.id]: 'running' };
            void attempt(async () => {
              const r = await send('step.test', { tabId: tabId!, step: s, origins: g.appOrigins, ...(shots.value?.on ? { guideId: g.id } : {}) });
              tests.value = { ...tests.value, [s.id]: r };
              if (r.shot === 'saved') void loadShots(g.id);
            });
          };
          const isPicking = picking.value === s.id;
          const repick = () => {
            if (picking.value === s.id) {
              void attempt(() => send('pick.cancel', { tabId: tabId! }));
              endPicking();
              return;
            }
            picking.value = s.id;
            clearTimeout(pickTimer);
            pickTimer = setTimeout(endPicking, 120_000); // the service worker stops accepting picks then
            void attempt(() => send('pick.start', { tabId: tabId!, origins: g.appOrigins })).then((r) => {
              if (!r) endPicking();
            });
          };
          const reasons = playReasons(s);
          const kind = KIND[s.kind];
          const titleId = `step-title-${s.id}`;
          const bodyId = `step-body-${s.id}`;
          const open = openSteps.value.has(s.id) || isPicking;
          const more = moreSteps.value.has(s.id);
          const moreId = `step-more-${s.id}`;
          return (
            <li key={s.id} class={`edit-step ${stepFlip.enter(s.id)}${isPicking ? ' picking' : ''}${open ? ' open' : ''}`} data-flip={s.id} data-testid={`step-${i}`} aria-labelledby={titleId}>
              <div class="step-head">
                {!readOnly && (
                  <button
                    type="button"
                    class={`ghost icon sm grip${lifted.value?.id === s.id ? ' lifted' : ''}`}
                    data-testid={`step-${i}-drag`}
                    aria-label={`Move step ${i + 1}`}
                    aria-describedby="reorder-help"
                    aria-pressed={lifted.value?.id === s.id}
                    title="Drag to move (or Space, then the arrow keys)"
                    onPointerDown={(e) => startDrag(e, stepFlip.ref.current, i, s.id, g.steps.length)}
                    onKeyDown={(e) => onHandleKey(e, i, s.id, g.steps.length)}
                    onBlur={(e) => onHandleBlur(e, i, s.id, g.steps.length)}
                  >
                    <Icon name="grip" />
                  </button>
                )}
                <span class="num" aria-hidden="true">
                  {i + 1}
                </span>
                <span class="badge">
                  <Icon name={kind.icon} />
                  {kind.label}
                </span>
                {s.optional && <span class="badge">Optional</span>}
                {!open && s.flags?.length ? (
                  <span class="badge warn" title={s.flags.map((f) => FLAG_HELP[f].label).join(', ')}>
                    <Icon name="warn" />
                    {FLAG_HELP[s.flags[0]!].label}
                  </span>
                ) : null}
                {!open && !s.flags?.length && reasons.length ? (
                  <span class="badge warn" data-testid={`step-${i}-may-break`} title={reasons.map(reasonText).join(', ')}>
                    <Icon name="warn" />
                    May break
                  </span>
                ) : null}
                <span class="push" />
                <button type="button" class="ghost icon sm" data-testid={`step-${i}-up`} aria-label={`Move step ${i + 1} up`} title="Move up" disabled={readOnly || i === 0} onClick={() => move(i, -1)}>
                  <Icon name="arrow-up" />
                </button>
                <button type="button" class="ghost icon sm" data-testid={`step-${i}-down`} aria-label={`Move step ${i + 1} down`} title="Move down" disabled={readOnly || i === g.steps.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="arrow-down" />
                </button>
                <button
                  type="button"
                  class="ghost icon sm danger"
                  data-testid={`step-${i}-delete`}
                  aria-label={`Delete step ${i + 1}`}
                  title="Delete step"
                  disabled={readOnly}
                  onClick={() => deleteStep(i)}
                >
                  <Icon name="trash" />
                </button>
              </div>
              <h4 class="step-title" id={titleId}>
                <button type="button" class="step-toggle" data-testid={`step-${i}-toggle`} aria-expanded={open} aria-controls={open ? bodyId : undefined} disabled={isPicking} onClick={() => toggleIn(openSteps, s.id)}>
                  <span class="visually-hidden">Step {i + 1}: </span>
                  <span class="grow">
                    <Markdown text={s.title || 'Untitled step'} noLinks />
                  </span>
                  <Icon name="chevron-down" class="chev" />
                </button>
              </h4>
              {open && (
                <div class="step-body unfold" id={bodyId}>
                  <FlagNotes flags={s.flags} testid={`step-${i}-flags`} />
                  {reasons.length > 0 && (
                    <div class="flag-notes" data-testid={`step-${i}-plays`}>
                      {reasons.map((r) => (
                        <p key={r.kind}>
                          <span class="badge warn">
                            <Icon name="warn" />
                            {reasonText(r)}
                          </span>{' '}
                          <span class="small muted">From plays on this device.</span>
                        </p>
                      ))}
                      {canTarget && (
                        <div class="toolbar">
                          <button type="button" class="ghost sm" data-testid={`step-${i}-plays-test`} disabled={tabId === null} onClick={runTest}>
                            <Icon name="test" />
                            Test step
                          </button>
                          <button type="button" class={`sm${isPicking ? ' primary' : ' ghost'}`} data-testid={`step-${i}-plays-repick`} aria-pressed={isPicking} disabled={readOnly || tabId === null || s.kind === 'cell'} onClick={repick}>
                            <Icon name={isPicking ? 'close' : 'crosshair'} />
                            {isPicking ? 'Cancel picking' : 'Re-pick element'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <label class="field">
                    <span class="label">
                      Title <span class="hint">· to make words bold, put two stars on each side: **like this**</span>
                    </span>
                    <input data-testid={`step-${i}-title`} value={s.title} disabled={readOnly} onInput={(e) => patchStep(s.id, { title: (e.target as HTMLInputElement).value })} />
                  </label>
                  {s.kind === 'cell' && s.cell && <CellField key={`${s.id}:${s.cell.ref}`} step={s} index={i} readOnly={readOnly} />}
                  <label class="field">
                    <span class="label">Note</span>
                    <textarea
                      data-testid={`step-${i}-note`}
                      rows={1}
                      value={s.note ?? ''}
                      placeholder="Optional. Shown under the title."
                      disabled={readOnly}
                      onInput={(e) => patchStep(s.id, { note: (e.target as HTMLTextAreaElement).value })}
                    />
                  </label>
                  <div class="toolbar step-actions">
                    {canTarget && (
                      <>
                        <button
                          type="button"
                          class="sm"
                          data-testid={`step-${i}-test`}
                          disabled={tabId === null}
                          title="Look for this step’s element on the page now"
                          onClick={runTest}
                        >
                          <Icon name="test" />
                          Test step
                        </button>
                        <button
                          type="button"
                          class={`sm${isPicking ? ' primary' : ''}`}
                          data-testid={`step-${i}-repick`}
                          aria-pressed={isPicking}
                          disabled={readOnly || tabId === null || s.kind === 'cell'}
                          title={s.kind === 'cell' ? 'A cell step always points at the Name Box; change the cell below' : 'Choose a different element on the page for this step'}
                          onClick={repick}
                        >
                          <Icon name={isPicking ? 'close' : 'crosshair'} />
                          {isPicking ? 'Cancel picking' : 'Re-pick element'}
                        </button>
                      </>
                    )}
                    <button type="button" class="ghost sm push" data-testid={`step-${i}-more`} aria-expanded={more} aria-controls={more ? moreId : undefined} onClick={() => toggleIn(moreSteps, s.id)}>
                      More options
                      <Icon name="chevron-down" class="chev" />
                    </button>
                  </div>
                  {more && (
                    <div class="step-more unfold" id={moreId}>
                      <label class="field">
                        <span class="label">
                          Spoken text <span class="hint">· what the voice says; leave empty to read the title and note</span>
                        </span>
                        <textarea
                          data-testid={`step-${i}-voice`}
                          rows={1}
                          value={s.voiceText ?? ''}
                          placeholder={voiceTextFor({ ...s, voiceText: undefined })}
                          disabled={readOnly}
                          onInput={(e) => patchStep(s.id, { voiceText: (e.target as HTMLTextAreaElement).value })}
                        />
                      </label>
                      <div class="row step-options">
                        <label class="inline-field">
                          <span class="label">Go to the next step</span>
                          <select
                            data-testid={`step-${i}-advance`}
                            value={s.advance}
                            disabled={readOnly || s.kind === 'note'}
                            onChange={(e) => patchStep(s.id, { advance: (e.target as HTMLSelectElement).value as Step['advance'] })}
                          >
                            <option value="action">when the learner does it</option>
                            <option value="next">when the learner presses Next</option>
                          </select>
                        </label>
                        <label class="check small">
                          <input
                            type="checkbox"
                            role="switch"
                            class="switch"
                            data-testid={`step-${i}-optional`}
                            checked={!!s.optional}
                            disabled={readOnly}
                            onChange={(e) => patchStep(s.id, { optional: (e.target as HTMLInputElement).checked || undefined })}
                          />
                          <span>Optional (learners may skip it)</span>
                        </label>
                      </div>
                      <div class="toolbar">
                        <AddStepButtons after={s.id} testid={`step-${i}-add`} label="after" g={g} tabId={tabId} readOnly={readOnly} />
                        <button type="button" class="ghost sm" data-testid={`step-${i}-add-note`} disabled={readOnly} onClick={() => insertNote(i)}>
                          <Icon name="plus" />
                          Add a note after
                        </button>
                        <button type="button" class="ghost sm" data-testid={`step-${i}-to-top`} disabled={readOnly || i === 0} onClick={() => moveTo(i, 0, 'up')}>
                          <Icon name="arrow-up" />
                          Move to top
                        </button>
                        <button type="button" class="ghost sm" data-testid={`step-${i}-to-bottom`} disabled={readOnly || i === g.steps.length - 1} onClick={() => moveTo(i, g.steps.length - 1, 'down')}>
                          <Icon name="arrow-down" />
                          Move to bottom
                        </button>
                        <button type="button" class="ghost sm" data-testid={`step-${i}-duplicate`} aria-label={`Duplicate step ${i + 1}`} disabled={readOnly} onClick={() => setSteps((steps) => duplicateStepIn(steps, i))}>
                          <Icon name="duplicate" />
                          Duplicate
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {isPicking && (
                <p class="banner" role="status">
                  <Icon name="crosshair" />
                  <span>
                    Click the right element on the page. The click won’t reach the app. Press <kbd>Esc</kbd> to cancel.
                  </span>
                </p>
              )}
              {open && noShot && (
                <div class="row small" data-testid={`step-${i}-noshot`}>
                  <span class="muted">
                    <Icon name="image" /> No screenshot
                  </span>
                  <button type="button" class="ghost sm" data-testid={`step-${i}-capture`} disabled={tabId === null || t === 'running'} title="Find the element on the page and take its screenshot" onClick={runTest}>
                    Capture
                  </button>
                </div>
              )}
              {open && oldShot && (
                <div class="row small" data-testid={`step-${i}-oldshot`}>
                  <span class="muted">
                    <Icon name="image" /> Close-up from an older version
                  </span>
                  <button type="button" class="ghost sm" data-testid={`step-${i}-capture`} disabled={tabId === null || t === 'running'} title="Find the element on the page and take a screenshot of the whole page" onClick={runTest}>
                    Capture again
                  </button>
                </div>
              )}
              <div role="status" class="test-result" data-testid={t ? `step-${i}-test-result` : undefined}>
                {t && <TestResultView t={t} />}
              </div>
              {suggested.value[s.id] && suggested.value[s.id] !== s.title && (
                <div class="row">
                  <button type="button" class="sm" data-testid={`step-${i}-use-title`} onClick={() => patchStep(s.id, { title: suggested.value[s.id]! })}>
                    Use title “{suggested.value[s.id]}”
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div class="toolbar">
        <AddStepButtons after="" testid="end-add" label="at the end" g={g} tabId={tabId} readOnly={readOnly} />
        <button type="button" class="ghost sm" disabled={readOnly} data-testid="add-note-end" onClick={() => insertNote(g.steps.length - 1)}>
          <Icon name="plus" />
          Add a note at the end
        </button>
      </div>
      {tabId === null && !readOnly && <p class="hint">To add steps, open a page of this guide’s site in this tab.</p>}
      <div class="editor-bar">
        <ToastSlot scope="editor" />
        {error.value && (
          <p class="alert" role="alert">
            <Icon name="error" />
            {error.value}
          </p>
        )}
        {status.value && (
          <p class="status-text ok" role="status" data-testid="editor-status">
            {status.value.startsWith('Saved') && <Icon key={status.value} name="check" class="tick" />}
            {status.value}
          </p>
        )}
        <div class="row">
          <button type="button" class="primary" data-testid="save-guide" disabled={readOnly || !dirty.value || saving.value} onClick={save}>
            {saving.value ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            class="ghost"
            data-testid="close-editor"
            onClick={() => {
              if (picking.value && tabId !== null) void send('pick.cancel', { tabId });
              endPicking();
              // Discarded: a later open of this guide loads the stored copy.
              draft.value = null;
              dirty.value = false;
              onClose();
            }}
          >
            {dirty.value ? 'Discard and close' : 'Close'}
          </button>
        </div>
      </div>
    </section>
  );
}

/** The matcher's signal names in plain words (src/core/matcher/signals.ts). */
const CLUE: Record<string, string> = {
  testId: 'a test label',
  id: 'id',
  roleName: 'its kind and name',
  text: 'text',
  name: 'name',
  href: 'its link',
  placeholder: 'placeholder',
  css: 'its path in the page',
  ancestors: 'what’s around it',
  xpath: 'its position in the page',
  position: 'where it is on screen',
  're-picked': 'picked by you',
};

/** What happened to the step's screenshot, after Test step or Capture (D187). */
const SHOT_RESULT: Record<NonNullable<TestResult['shot']>, string> = {
  saved: 'Screenshot saved.',
  refused: SHOT_HINT_PANEL,
  skipped: 'No screenshot this time: the element was not on screen, or the page changed. Try again.',
};

/** Test step feedback: found (with the clues that matched), fragile, or not found. */
function TestResultView({ t }: { t: TestResult | 'running' }) {
  if (t === 'running')
    return (
      <p class="status-text">
        <Icon name="loader" /> Looking for the element…
      </p>
    );
  if (!t.found)
    return (
      <div class="banner danger">
        <Icon name="error" />
        <span>
          <strong>Not found.</strong> {t.reason ?? 'Not found on this page.'}
        </span>
      </div>
    );
  return (
    <div class={`banner ${t.fragile ? 'warn' : 'success'}`}>
      <Icon name={t.fragile ? 'warn' : 'check'} />
      <div class="stack-sm">
        <span>
          <strong>{t.fragile ? 'Found, but it may break.' : 'Found on this page.'}</strong>
          {t.fragile && ' Waymark found it with only one strong clue, so a small change to the app could break this step. Re-pick the element to make it sturdier.'}
        </span>
        <details class="clues">
          <summary class="small">How Waymark found it</summary>
          <span class="clue-list">
            <span class="visually-hidden">Matched: </span>
            {t.matched.map((m) => (
              <span key={m} class="badge">
                {CLUE[m] ?? m}
              </span>
            ))}
          </span>
          {t.fragile && <span class="small muted">If you own the app, a data-guide-id attribute on the element makes it easy to find.</span>}
        </details>
        {t.shot && (
          <span class="small" data-testid="shot-result" data-shot={t.shot}>
            {SHOT_RESULT[t.shot]}
          </span>
        )}
      </div>
    </div>
  );
}
