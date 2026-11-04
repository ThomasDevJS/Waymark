import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { RecordingState } from '../../core/recorder/session';
import type { GuideIndexEntry } from '../../core/storage/guides';
import type { RunView } from '../../core/player/run';
import { Markdown } from './Markdown';

const recording = signal<RecordingState | null>(null);
const saved = signal<{ title: string; count: number } | null>(null);
const guides = signal<GuideIndexEntry[]>([]);
const title = signal('');
const noteTitle = signal('');
const noteOpen = signal(false);
const error = signal<string | null>(null);
const run = signal<RunView | null>(null);
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
  guides.value = (await attempt(() => send('guide.list', {})))?.guides ?? [];
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

export function Recorder({ tabId }: { tabId: number | null }) {
  useEffect(() => {
    void refresh(tabId);
    // The panel is a trusted context and may watch session storage directly.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && 'recording' in changes) recording.value = (changes.recording!.newValue as RecordingState | undefined) ?? null;
      if (area === 'session' && tabId !== null && `run:${tabId}` in changes) void refresh(tabId);
      if (area === 'local' && 'guides:index' in changes) void refresh(tabId);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [tabId]);

  const r = recording.value;
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
        {guides.value.length > 0 && (
          <>
            <h2>Guides</h2>
            <ul class="guides">
              {guides.value.map((g) => (
                <li key={g.id} class="row">
                  <span class="grow">
                    {g.title} <span class="muted">· {g.steps} steps</span>
                  </span>
                  <button type="button" data-testid={`start-${g.id}`} disabled={tabId === null} onClick={() => tabId !== null && void startGuide(tabId, g.id)}>
                    Start
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
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
              if (res) saved.value = { title: res.title, count: res.steps.length };
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
