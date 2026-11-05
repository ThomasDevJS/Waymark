/**
 * Guide editor (SPEC: User flows, Edit): edit each step's title, note, voice text, advance mode
 * and whether it is optional; Test step; Re-pick element; reorder, delete or insert steps.
 * Save bumps the guide version.
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { ElementFingerprint, Guide, Step } from '../../core/model/schema';
import { newId } from '../../core/model/ids';
import { voiceTextFor } from '../../core/voice/voice';
import type { TestResult } from '../../background/editor';
import { Markdown } from './Markdown';
import { Icon } from '../../ui/Icon';
import { FlagNotes, KIND } from './steps';
import { parseTags } from '../../core/discovery/tags';
import { UNDO_MS } from '../../core/storage/trash';
import { dismissScope, showToast, ToastSlot } from './Toast';

const draft = signal<Guide | null>(null);
const dirty = signal(false);
const status = signal<string | null>(null);
const error = signal<string | null>(null);
const tests = signal<Record<string, TestResult | 'running'>>({});
const picking = signal<string | null>(null);
const suggested = signal<Record<string, string>>({});
const saving = signal(false);
/** revisionId of the copy the draft was loaded from; Save is refused if it changed elsewhere. */
const base = signal<string | null>(null);
/** The tags field as typed ("a, b"); the draft holds the parsed list. */
const tagsText = signal('');
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

function move(index: number, by: number) {
  setSteps((steps) => {
    const to = index + by;
    if (to < 0 || to >= steps.length) return steps;
    const copy = steps.slice();
    [copy[index], copy[to]] = [copy[to]!, copy[index]!];
    return copy;
  });
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

/** Deletes a step from the draft; the toast's Undo puts it back until the draft is saved or closed. */
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

function insertNote(after: number) {
  setSteps((steps) => {
    const ref = steps[after] ?? steps[steps.length - 1];
    const note: Step = { id: newId(), kind: 'note', title: 'New note', url: ref?.url ?? { kind: 'prefix', value: '/' }, advance: 'next' };
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

export function Editor({ guideId, tabId, onClose }: { guideId: string; tabId: number | null; onClose: () => void }) {
  useEffect(() => {
    draft.value = null;
    dirty.value = false;
    status.value = null;
    tests.value = {};
    void attempt(async () => {
      const g = await send('guide.get', { id: guideId });
      draft.value = g;
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
          Tags <span class="hint">· separated by commas; the library filters by them</span>
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
      <div class="row">
        <span class="badge">Version {g.version}</span>
        <span class="badge">
          {g.steps.length} {g.steps.length === 1 ? 'step' : 'steps'}
        </span>
        {readOnly && <span class="badge accent">Team guide · read-only</span>}
        {dirty.value && <span class="badge warn">Unsaved changes</span>}
      </div>
      {readOnly && <p class="small muted">Team guides are read-only. Use Duplicate in the list to edit your own copy.</p>}
      <h3 class="section-label" id="steps-heading" tabIndex={-1}>
        <Icon name="steps" />
        Steps
      </h3>
      <ol class="edit-steps" aria-label="Steps">
        {g.steps.map((s, i) => {
          const t = tests.value[s.id];
          const canTarget = s.kind !== 'note' && s.kind !== 'navigate';
          const isPicking = picking.value === s.id;
          const kind = KIND[s.kind];
          const titleId = `step-title-${s.id}`;
          return (
            <li key={s.id} class={`edit-step${isPicking ? ' picking' : ''}`} data-testid={`step-${i}`} aria-labelledby={titleId}>
              <div class="step-head">
                <span class="num" aria-hidden="true">
                  {i + 1}
                </span>
                <span class="badge">
                  <Icon name={kind.icon} />
                  {kind.label}
                </span>
                {s.optional && <span class="badge">Optional</span>}
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
                <span class="visually-hidden">Step {i + 1}: </span>
                <Markdown text={s.title || 'Untitled step'} />
              </h4>
              <FlagNotes flags={s.flags} testid={`step-${i}-flags`} />
              <label class="field">
                <span class="label">Title</span>
                <input data-testid={`step-${i}-title`} value={s.title} disabled={readOnly} onInput={(e) => patchStep(s.id, { title: (e.target as HTMLInputElement).value })} />
              </label>
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
              <label class="field">
                <span class="label">
                  Voice text <span class="hint">· read aloud; leave empty to read the title and note</span>
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
                  <span class="label">Moves on</span>
                  <select
                    data-testid={`step-${i}-advance`}
                    value={s.advance}
                    disabled={readOnly || s.kind === 'note'}
                    onChange={(e) => patchStep(s.id, { advance: (e.target as HTMLSelectElement).value as Step['advance'] })}
                  >
                    <option value="action">when the learner does it</option>
                    <option value="next">with the Next button</option>
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
                  <span>Optional</span>
                </label>
              </div>
              <div class="toolbar step-actions">
                {canTarget && (
                  <>
                    <button
                      type="button"
                      class="sm"
                      data-testid={`step-${i}-test`}
                      disabled={tabId === null}
                      onClick={() => {
                        tests.value = { ...tests.value, [s.id]: 'running' };
                        void attempt(async () => {
                          const r = await send('step.test', { tabId: tabId!, step: s, origins: g.appOrigins });
                          tests.value = { ...tests.value, [s.id]: r };
                        });
                      }}
                    >
                      <Icon name="test" />
                      Test step
                    </button>
                    <button
                      type="button"
                      class={`sm${isPicking ? ' primary' : ''}`}
                      data-testid={`step-${i}-repick`}
                      aria-pressed={isPicking}
                      disabled={readOnly || tabId === null}
                      onClick={() => {
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
                      }}
                    >
                      <Icon name={isPicking ? 'close' : 'crosshair'} />
                      {isPicking ? 'Cancel picking' : 'Re-pick element'}
                    </button>
                  </>
                )}
                <button type="button" class="ghost sm" data-testid={`step-${i}-add-note`} disabled={readOnly} onClick={() => insertNote(i)}>
                  <Icon name="plus" />
                  Note after
                </button>
                <button type="button" class="ghost sm" data-testid={`step-${i}-duplicate`} aria-label={`Duplicate step ${i + 1}`} disabled={readOnly} onClick={() => setSteps((steps) => duplicateStepIn(steps, i))}>
                  <Icon name="duplicate" />
                  Duplicate
                </button>
              </div>
              {isPicking && (
                <p class="banner" role="status">
                  <Icon name="crosshair" />
                  <span>
                    Click the right element on the page. The click won’t reach the app. Press <kbd>Esc</kbd> to cancel.
                  </span>
                </p>
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
      <div>
        <button type="button" class="ghost" disabled={readOnly} data-testid="add-note-end" onClick={() => insertNote(g.steps.length - 1)}>
          <Icon name="plus" />
          Add note at end
        </button>
      </div>
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
  testId: 'test id',
  id: 'id',
  roleName: 'role and name',
  text: 'text',
  name: 'name',
  href: 'link',
  placeholder: 'placeholder',
  css: 'CSS path',
  ancestors: 'surroundings',
  xpath: 'page position',
  position: 'screen position',
  're-picked': 'picked by you',
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
          <strong>{t.fragile ? 'Found, but fragile.' : 'Found.'}</strong>
          {t.fragile && ' Only one strong clue matched, so a small app change may break it. Re-pick it, or add a data-guide-id to the element.'}
        </span>
        <span class="clues">
          <span class="visually-hidden">Matched: </span>
          {t.matched.map((m) => (
            <span key={m} class="badge">
              {CLUE[m] ?? m}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
