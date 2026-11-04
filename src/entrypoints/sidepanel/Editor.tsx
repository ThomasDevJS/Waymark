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

const draft = signal<Guide | null>(null);
const dirty = signal(false);
const status = signal<string | null>(null);
const error = signal<string | null>(null);
const tests = signal<Record<string, TestResult | 'running'>>({});
const picking = signal<string | null>(null);
const suggested = signal<Record<string, string>>({});

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
      for (const k of Object.keys(patch) as (keyof Step)[]) if (patch[k] === undefined || patch[k] === '') delete next[k];
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
    void attempt(async () => (draft.value = await send('guide.get', { id: guideId })));
  }, [guideId]);

  // Re-pick results arrive through session storage (the panel is a trusted context).
  useEffect(() => {
    if (tabId === null) return;
    const key = `pickResult:${tabId}`;
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session' || !(key in changes)) return;
      const r = changes[key]!.newValue as { target: ElementFingerprint; title: string } | undefined;
      const stepId = picking.value;
      if (!r || !stepId) return;
      patchStep(stepId, { target: r.target });
      suggested.value = { ...suggested.value, [stepId]: r.title };
      tests.value = { ...tests.value, [stepId]: { found: true, score: 100, margin: 100, matched: ['re-picked'], fragile: false } };
      picking.value = null;
      void chrome.storage.session.remove(key);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [tabId]);

  const g = draft.value;
  if (!g) return <section class="site">{error.value ? <p role="alert">{error.value}</p> : <p class="muted">Loading…</p>}</section>;
  const readOnly = g.source === 'library';

  return (
    <section class="site editor" aria-label="Guide editor">
      <div class="row">
        <label class="grow">
          <span class="muted">Guide title</span>
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
      </div>
      <p class="muted">
        Version {g.version}
        {readOnly ? ' · library guide (read-only)' : ''}
        {dirty.value ? ' · unsaved changes' : ''}
      </p>
      <ol class="edit-steps">
        {g.steps.map((s, i) => {
          const t = tests.value[s.id];
          const canTarget = s.kind !== 'note' && s.kind !== 'navigate';
          return (
            <li key={s.id} class="edit-step" data-testid={`step-${i}`}>
              <div class="row">
                <strong class="grow">
                  {i + 1}. <Markdown text={s.title} />
                </strong>
                <span class="muted">{s.kind}</span>
                {s.flags?.length ? (
                  <span class="flag" title={s.flags.join(', ')}>
                    ⚠ {s.flags.join(', ')}
                  </span>
                ) : null}
              </div>
              <label class="grow">
                <span class="muted">Title</span>
                <input data-testid={`step-${i}-title`} value={s.title} disabled={readOnly} onInput={(e) => patchStep(s.id, { title: (e.target as HTMLInputElement).value })} />
              </label>
              <label class="grow">
                <span class="muted">Note</span>
                <textarea data-testid={`step-${i}-note`} rows={2} value={s.note ?? ''} disabled={readOnly} onInput={(e) => patchStep(s.id, { note: (e.target as HTMLTextAreaElement).value })} />
              </label>
              <label class="grow">
                <span class="muted">Voice text</span>
                <textarea
                  data-testid={`step-${i}-voice`}
                  rows={2}
                  value={s.voiceText ?? ''}
                  placeholder={voiceTextFor({ ...s, voiceText: undefined })}
                  disabled={readOnly}
                  onInput={(e) => patchStep(s.id, { voiceText: (e.target as HTMLTextAreaElement).value })}
                />
              </label>
              <div class="row">
                <label>
                  <span class="muted">Advance </span>
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
                <label>
                  <input type="checkbox" data-testid={`step-${i}-optional`} checked={!!s.optional} disabled={readOnly} onChange={(e) => patchStep(s.id, { optional: (e.target as HTMLInputElement).checked || undefined })} /> Optional
                </label>
              </div>
              <div class="row">
                <button type="button" aria-label="Move up" disabled={readOnly || i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" aria-label="Move down" disabled={readOnly || i === g.steps.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" data-testid={`step-${i}-delete`} disabled={readOnly} onClick={() => setSteps((steps) => steps.filter((x) => x.id !== s.id))}>
                  Delete
                </button>
                <button type="button" data-testid={`step-${i}-add-note`} disabled={readOnly} onClick={() => insertNote(i)}>
                  Add note after
                </button>
                {canTarget && (
                  <>
                    <button
                      type="button"
                      data-testid={`step-${i}-test`}
                      disabled={tabId === null}
                      onClick={() => {
                        tests.value = { ...tests.value, [s.id]: 'running' };
                        void attempt(async () => {
                          const r = await send('step.test', { tabId: tabId!, step: s });
                          tests.value = { ...tests.value, [s.id]: r };
                        });
                      }}
                    >
                      Test step
                    </button>
                    <button
                      type="button"
                      data-testid={`step-${i}-repick`}
                      disabled={readOnly || tabId === null}
                      onClick={() => {
                        picking.value = s.id;
                        void attempt(() => send('pick.start', { tabId: tabId! }));
                      }}
                    >
                      {picking.value === s.id ? 'Click it on the page…' : 'Re-pick element'}
                    </button>
                  </>
                )}
              </div>
              {t && (
                <p class="muted" data-testid={`step-${i}-test-result`} role="status">
                  {t === 'running'
                    ? 'Looking for the element…'
                    : t.found
                      ? `Found (score ${Math.round(t.score)}; matched ${t.matched.join(', ')})${t.fragile ? ' — fragile: only one strong signal matched; consider re-picking or a data-guide-id' : ''}`
                      : t.reason ?? 'Not found on this page.'}
                </p>
              )}
              {suggested.value[s.id] && suggested.value[s.id] !== s.title && (
                <button type="button" data-testid={`step-${i}-use-title`} onClick={() => patchStep(s.id, { title: suggested.value[s.id]! })}>
                  Use title “{suggested.value[s.id]}”
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <div class="row">
        <button type="button" disabled={readOnly} data-testid="add-note-end" onClick={() => insertNote(g.steps.length - 1)}>
          Add note step
        </button>
      </div>
      {error.value && <p role="alert">{error.value}</p>}
      {status.value && <p role="status" data-testid="editor-status">{status.value}</p>}
      <div class="row">
        <button
          type="button"
          class="primary"
          data-testid="save-guide"
          disabled={readOnly || !dirty.value}
          onClick={() =>
            void attempt(async () => {
              const saved = await send('guide.save', { guide: draft.value! });
              draft.value = saved;
              dirty.value = false;
              status.value = `Saved (version ${saved.version}).`;
            })
          }
        >
          Save
        </button>
        <button
          type="button"
          data-testid="close-editor"
          onClick={() => {
            if (picking.value && tabId !== null) void send('pick.cancel', { tabId });
            picking.value = null;
            onClose();
          }}
        >
          {dirty.value ? 'Discard and close' : 'Close'}
        </button>
      </div>
    </section>
  );
}
