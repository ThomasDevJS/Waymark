import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { RecordingState } from '../../core/recorder/session';
import type { RunView } from '../../core/player/run';
import { Markdown } from './Markdown';
import { Editor } from './Editor';
import { Library } from './Library';

const recording = signal<RecordingState | null>(null);
const saved = signal<{ title: string; count: number } | null>(null);
const title = signal('');
const noteTitle = signal('');
const noteOpen = signal(false);
const error = signal<string | null>(null);
const run = signal<RunView | null>(null);
const editing = signal<string | null>(null);
const needsStart = signal<{ guideId: string; startUrl: string; reachable: boolean; pattern: string } | null>(null);

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

async function startGuide(tabId: number, guideId: string, openStart = false) {
  const res = await attempt(() => send('run.start', { tabId, guideId, openStart }));
  if (!res) return;
  if (res.status === 'needs-start') needsStart.value = { guideId, startUrl: res.startUrl, reachable: res.reachable, pattern: res.pattern };
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
  if (!r && editing.value) {
    return (
      <>
        {saved.value && (
          <p role="status" data-testid="saved">
            Saved “{saved.value.title}” with {saved.value.count} steps. Review the steps below.
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
    return (
      <section class="site" aria-label="Recorder">
        {saved.value && (
          <p role="status" data-testid="saved">
            Saved “{saved.value.title}” with {saved.value.count} steps.
          </p>
        )}
        <form
          class="row"
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
          <label class="grow">
            <span class="muted">New guide</span>
            <input data-testid="guide-title" value={title.value} placeholder="Guide name" onInput={(e) => (title.value = (e.target as HTMLInputElement).value)} />
          </label>
          <button type="submit" class="primary" data-testid="record" disabled={tabId === null}>
            Record
          </button>
        </form>
        {error.value && <p role="alert">{error.value}</p>}
        {run.value?.active && run.value.status !== 'none' && (
          <div class="row" data-testid="run-status">
            <span class="grow">
              {run.value.status === 'finished'
                ? `Finished: ${run.value.guideTitle}`
                : run.value.status === 'paused'
                  ? `Paused (continued in another tab): ${run.value.guideTitle}`
                  : `Playing: ${run.value.guideTitle} · step ${run.value.stepIndex + 1} of ${run.value.total}`}
            </span>
            <button type="button" data-testid="stop-run" onClick={() => tabId !== null && void attempt(async () => (await send('run.stop', { tabId }), await refresh(tabId)))}>
              Stop
            </button>
          </div>
        )}
        {needsStart.value && tabId !== null && (
          <div class="row" role="status">
            {needsStart.value.reachable ? (
              <>
                <span class="grow">This guide starts on another page.</span>
                <button type="button" class="primary" data-testid="open-start" onClick={() => void startGuide(tabId, needsStart.value!.guideId, true)}>
                  Open start page
                </button>
              </>
            ) : (
              <span class="grow" data-testid="start-hint">
                This guide starts on a page like <code>{needsStart.value.pattern}</code>. Open that page, then press Start.
              </span>
            )}
          </div>
        )}
        <Library tabId={tabId} tabUrl={tabUrl} onEdit={(id) => openEditor(id, tabId)} onStart={(id) => tabId !== null && void startGuide(tabId, id)} />
      </section>
    );
  }

  return (
    <section class="site" aria-label="Recorder">
      <div class="row">
        <strong class="grow">
          {r.status === 'recording' ? '● Recording' : 'Paused'}: {r.title}
        </strong>
      </div>
      <div class="row">
        {r.status === 'recording' ? (
          <button type="button" data-testid="pause" onClick={() => void attempt(() => send('rec.pause', {}))}>
            Pause
          </button>
        ) : (
          <button type="button" data-testid="resume" onClick={() => void attempt(() => send('rec.resume', {}))}>
            Resume
          </button>
        )}
        <button type="button" data-testid="undo" disabled={!r.steps.length} onClick={() => void attempt(() => send('rec.undo', {}))}>
          Undo last step
        </button>
        <button type="button" data-testid="add-note" onClick={() => (noteOpen.value = !noteOpen.value)}>
          Add note
        </button>
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
          Stop
        </button>
      </div>
      {noteOpen.value && (
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            void attempt(async () => {
              await send('rec.note', { title: noteTitle.value });
              noteTitle.value = '';
              noteOpen.value = false;
            });
          }}
        >
          <input class="grow" aria-label="Note" placeholder="Note text" value={noteTitle.value} onInput={(e) => (noteTitle.value = (e.target as HTMLInputElement).value)} />
          <button type="submit">Add</button>
        </form>
      )}
      {error.value && <p role="alert">{error.value}</p>}
      <ol class="steps" data-testid="steps" aria-live="polite">
        {r.steps.map((s) => (
          <li key={s.id} data-kind={s.kind}>
            <Markdown text={s.title} />
            {s.flags?.length ? <span class="flag" title={s.flags.join(', ')}> ⚠</span> : null}
          </li>
        ))}
      </ol>
      {!r.steps.length && <p class="muted">Use the app; each action appears here as a step.</p>}
    </section>
  );
}
