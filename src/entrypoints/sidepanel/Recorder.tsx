import { computed, signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { RecordingState } from '../../core/recorder/session';
import type { RunView } from '../../core/player/run';
import { Markdown } from './Markdown';
import { Editor, editorHasUnsavedEdits } from './Editor';
import { Library } from './Library';
import { Icon } from '../../ui/Icon';
import { FLAG_HELP, FlagNotes } from './steps';
import type { ShortcutOutcome } from '../../core/storage/shortcut';

const recording = signal<RecordingState | null>(null);
const saved = signal<{ title: string; count: number } | null>(null);
const title = signal('');
const noteTitle = signal('');
const noteOpen = signal(false);
const error = signal<string | null>(null);
const run = signal<RunView | null>(null);
const editing = signal<string | null>(null);
/** Recording or editing: the panel shows only that (Tutorials step aside). */
export const recorderBusy = computed(() => !!recording.value || !!editing.value);
const needsStart = signal<{ guideId: string; startUrl: string; reachable: boolean; pattern: string; stepIndex?: number } | null>(null);

async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    error.value = null;
    return await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return undefined;
  }
}

async function refresh(tabId?: number | null) {
  recording.value = (await attempt(() => send('rec.state', {}))) ?? null;
  if (tabId !== undefined && tabId !== null) run.value = (await attempt(() => send('run.state', { tabId }))) ?? null;
}

async function startGuide(tabId: number, guideId: string, openStart = false, stepIndex?: number) {
  const res = await attempt(() => send('run.start', { tabId, guideId, openStart, ...(stepIndex ? { stepIndex } : {}) }));
  if (!res) return;
  if (res.status === 'needs-start') needsStart.value = { guideId, startUrl: res.startUrl, reachable: res.reachable, pattern: res.pattern, ...(res.stepIndex ? { stepIndex: res.stepIndex } : {}) };
  else {
    needsStart.value = null;
    await refresh(tabId);
  }
}

/**
 * Without chrome.sidePanel the panel is a popup that closes when the page is clicked, so the
 * editor opens in a full-page tab instead (SPEC: Distribution, browser differences).
 */
function openEditor(id: string, tabId: number | null) {
  if (typeof chrome.sidePanel === 'undefined' && !new URLSearchParams(location.search).has('edit')) {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?edit=${encodeURIComponent(id)}${tabId !== null ? `&tab=${tabId}` : ''}`) });
    return;
  }
  editing.value = id;
}

/** A recording stopped with the shortcut whose editor did not open, because of unsaved edits. */
const stoppedAside = signal<{ guideId: string; title: string; count: number } | null>(null);

/**
 * Stopped with the keyboard shortcut (D105): open the editor, as the Stop button does. The state
 * lives in this module, so it applies even while the Recorder is not shown (a tab Waymark is not
 * allowed on); unsaved edits in an open editor are never replaced, the panel offers the new guide.
 */
export function showStopped(o: Extract<ShortcutOutcome, { kind: 'stopped' }>, tabId: number | null): void {
  recording.value = null;
  if (editing.value && editing.value !== o.guideId && editorHasUnsavedEdits()) {
    stoppedAside.value = { guideId: o.guideId, title: o.title, count: o.count };
    return;
  }
  saved.value = { title: o.title, count: o.count };
  openEditor(o.guideId, tabId);
}

/** What a screen reader hears when a step is recorded: its number, title and warning names. */
export function lastStepAnnouncement(steps: RecordingState['steps']): string {
  const s = steps[steps.length - 1];
  if (!s) return '';
  const flags = s.flags?.length ? `. Warning: ${s.flags.map((f) => FLAG_HELP[f].label).join(', ')}` : '';
  return `Step ${steps.length}: ${s.title.replace(/\*\*?/g, '')}${flags}`;
}

export function Recorder({ tabId, tabUrl, initialEdit }: { tabId: number | null; tabUrl: string | null; initialEdit?: string | null }) {
  useEffect(() => {
    if (initialEdit) editing.value = initialEdit;
  }, [initialEdit]);

  useEffect(() => {
    void refresh(tabId);
    // The panel is a trusted context and may watch session storage directly.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && 'recording' in changes) recording.value = (changes.recording!.newValue as RecordingState | undefined) ?? null;
      if (area === 'session' && tabId !== null && `run:${tabId}` in changes) void refresh(tabId);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [tabId]);

  const r = recording.value;
  const errorBox = error.value && (
    <p class="alert" role="alert">
      <Icon name="error" />
      {error.value}
    </p>
  );
  if (!r && editing.value) {
    const aside = stoppedAside.value;
    return (
      <>
        {aside && (
          <div class="banner success" role="status" data-testid="stopped-aside">
            <Icon name="check" />
            <div class="row grow">
              <span class="grow">
                Saved “{aside.title}” with {aside.count} {aside.count === 1 ? 'step' : 'steps'}. Your unsaved edits here are kept.
              </span>
              <button
                type="button"
                class="sm"
                data-testid="open-stopped"
                onClick={() => {
                  stoppedAside.value = null;
                  saved.value = { title: aside.title, count: aside.count };
                  openEditor(aside.guideId, tabId);
                }}
              >
                Open it (discard edits)
              </button>
            </div>
          </div>
        )}
        {saved.value && (
          <p class="banner success" role="status" data-testid="saved">
            <Icon name="check" />
            <span>
              Saved “{saved.value.title}” with {saved.value.count} {saved.value.count === 1 ? 'step' : 'steps'}. Check the steps below; Save after any changes.
            </span>
          </p>
        )}
        <Editor
          guideId={editing.value}
          tabId={tabId}
          onClose={() => {
            editing.value = null;
            saved.value = null;
          }}
        />
      </>
    );
  }
  if (!r) {
    const rv = run.value;
    return (
      <>
        {saved.value && (
          <p class="banner success" role="status" data-testid="saved">
            <Icon name="check" />
            <span>
              Saved “{saved.value.title}” with {saved.value.count} {saved.value.count === 1 ? 'step' : 'steps'}.
            </span>
          </p>
        )}
        {rv?.active && rv.status !== 'none' && (
          <section class="card run-card" aria-label="Guide playing" data-testid="run-status">
            <div class="card-head">
              <div class="stack-sm">
                <span class="section-label">
                  {rv.status === 'finished' ? 'Finished' : rv.status === 'paused' ? 'Paused · continued in another tab' : `Playing · step ${rv.stepIndex + 1} of ${rv.total}`}
                </span>
                <strong class="truncate">{rv.guideTitle}</strong>
                {rv.status === 'running' && rv.step && (
                  <span class="small muted" data-testid="run-step">
                    Now: {rv.step.title.replace(/\*\*?/g, '')}
                  </span>
                )}
              </div>
              <div class="row nowrap">
                {rv.guideId && rv.status !== 'paused' && (
                  <button type="button" class="ghost" data-testid="restart-run" aria-label={`Restart ${rv.guideTitle ?? 'the guide'} from step 1`} onClick={() => tabId !== null && void startGuide(tabId, rv.guideId!)}>
                    <Icon name="restart" />
                    Restart
                  </button>
                )}
                <button type="button" data-testid="stop-run" onClick={() => tabId !== null && void attempt(async () => (await send('run.stop', { tabId }), await refresh(tabId)))}>
                  <Icon name="stop" />
                  {rv.status === 'finished' ? 'Close' : 'Stop'}
                </button>
              </div>
            </div>
            {rv.status === 'running' && rv.total > 0 && (
              <div class="meter" role="progressbar" aria-label="Guide progress" aria-valuemin={1} aria-valuemax={rv.total} aria-valuenow={rv.stepIndex + 1}>
                <span style={{ width: `${((rv.stepIndex + 1) / rv.total) * 100}%` }} />
              </div>
            )}
          </section>
        )}
        {needsStart.value && tabId !== null && (
          <div class="banner" role="status">
            <Icon name="info" />
            {needsStart.value.reachable ? (
              <div class="row grow">
                <span class="grow">This guide starts on another page.</span>
                <button type="button" class="primary sm" data-testid="open-start" onClick={() => void startGuide(tabId, needsStart.value!.guideId, true)}>
                  Open start page
                </button>
              </div>
            ) : (
              <span class="grow" data-testid="start-hint">
                {needsStart.value.stepIndex ? `Step ${needsStart.value.stepIndex + 1} is on a page like ` : 'This guide starts on a page like '}
                <code>{needsStart.value.pattern}</code>. Open that page, then press {needsStart.value.stepIndex ? `Start from step ${needsStart.value.stepIndex + 1}` : 'Start'}.
              </span>
            )}
          </div>
        )}
        {/* While a guide plays, recording is one step away: the playing card is the focus (D120). */}
        {rv?.active && rv.status === 'running' ? null : (
        <section class="card record-card" aria-labelledby="record-title">
          <h2 id="record-title" class="card-title">
            Record a guide
          </h2>
          <form
            class="record-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (tabId === null) return;
              void attempt(async () => {
                recording.value = await send('rec.start', { tabId, title: title.value });
                saved.value = null;
                title.value = '';
              });
            }}
          >
            <label class="field grow">
              <span class="label">Guide name</span>
              <input data-testid="guide-title" value={title.value} placeholder="e.g. Create an invoice" onInput={(e) => (title.value = (e.target as HTMLInputElement).value)} />
            </label>
            <button type="submit" class="primary record" data-testid="record" disabled={tabId === null}>
              <span class="rec-dot" aria-hidden="true" />
              Record
            </button>
          </form>
          <p class="hint">Then do the task on the page. Each click becomes a step. What you type is never saved.</p>
          {errorBox}
        </section>
        )}
        {rv?.active && rv.status === 'running' && errorBox}
        <section class="card" aria-label="Guides">
          <Library tabId={tabId} tabUrl={tabUrl} onEdit={(id) => openEditor(id, tabId)} onStart={(id, stepIndex) => tabId !== null && void startGuide(tabId, id, false, stepIndex)} />
        </section>
      </>
    );
  }

  const recordingNow = r.status === 'recording';
  return (
    <section class={`card rec-card${recordingNow ? ' is-recording' : ''}`} aria-label="Recorder">
      <div class="card-head">
        <div class="stack-sm">
          <span class={`badge ${recordingNow ? 'rec' : ''}`} data-testid="rec-status">
            <span class="rec-dot" aria-hidden="true" />
            {recordingNow ? 'Recording' : 'Paused'}
          </span>
          <strong class="truncate">{r.title}</strong>
        </div>
        <button
          type="button"
          class="primary"
          data-testid="stop"
          onClick={() =>
            void attempt(async () => {
              const res = await send('rec.stop', {});
              recording.value = null;
              if (res) {
                saved.value = { title: res.title, count: res.steps.length };
                openEditor(res.guideId, tabId); // Stop opens the editor (SPEC: Record step 6)
              }
              await refresh(tabId);
            })
          }
        >
          <Icon name="stop" />
          Stop
        </button>
      </div>
      <p class="hint">{recordingNow ? 'Do the task on the page. Press Stop when you’re done: the guide is saved and opens for editing.' : 'Paused: clicks on the page aren’t recorded. Press Resume to go on, or Stop to save the guide.'}</p>
      <div class="toolbar" role="toolbar" aria-label="Recording">
        {recordingNow ? (
          <button type="button" data-testid="pause" onClick={() => void attempt(() => send('rec.pause', {}))}>
            <Icon name="pause" />
            Pause
          </button>
        ) : (
          <button type="button" data-testid="resume" onClick={() => void attempt(() => send('rec.resume', {}))}>
            <Icon name="play" />
            Resume
          </button>
        )}
        <button type="button" data-testid="undo" disabled={!r.steps.length} onClick={() => void attempt(() => send('rec.undo', {}))}>
          <Icon name="undo" />
          Undo
        </button>
        <button type="button" data-testid="add-note" aria-expanded={noteOpen.value} onClick={() => (noteOpen.value = !noteOpen.value)}>
          <Icon name="note" />
          Add note
        </button>
      </div>
      {noteOpen.value && (
        <form
          class="row nowrap"
          onSubmit={(e) => {
            e.preventDefault();
            void attempt(async () => {
              await send('rec.note', { title: noteTitle.value });
              noteTitle.value = '';
              noteOpen.value = false;
            });
          }}
        >
          <input class="grow" aria-label="Note" placeholder="A tip for the learner, shown as its own step" value={noteTitle.value} onInput={(e) => (noteTitle.value = (e.target as HTMLInputElement).value)} />
          <button type="submit">Add</button>
        </form>
      )}
      {errorBox}
      {r.steps.length ? (
        <ol class="live-steps" data-testid="steps" aria-label="Recorded steps">
          {r.steps.map((s, i) => (
            <li key={s.id} data-kind={s.kind}>
              <span class="num" aria-hidden="true">
                {i + 1}
              </span>
              <div class="grow">
                <div class="step-title">
                  <Markdown text={s.title} />
                </div>
                <FlagNotes flags={s.flags} later />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <ol class="live-steps" data-testid="steps" aria-label="Recorded steps" />
      )}
      <p class="visually-hidden" aria-live="polite">
        {lastStepAnnouncement(r.steps)}
      </p>
      {!r.steps.length && (
        <div class="empty">
          <Icon name="crosshair" />
          <strong>{recordingNow ? 'Waiting for your first click' : 'Recording is paused'}</strong>
          <span class="small">{recordingNow ? 'Each click and field you use on the page appears here as a step.' : 'Clicks on the page are not recorded now. Press Resume to record more steps.'}</span>
        </div>
      )}
    </section>
  );
}
