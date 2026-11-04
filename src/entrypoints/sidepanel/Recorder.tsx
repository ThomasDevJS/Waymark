import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { RecordingState } from '../../core/recorder/session';
import type { GuideIndexEntry } from '../../core/storage/guides';
import { Markdown } from './Markdown';

const recording = signal<RecordingState | null>(null);
const saved = signal<{ title: string; count: number } | null>(null);
const guides = signal<GuideIndexEntry[]>([]);
const title = signal('');
const noteTitle = signal('');
const noteOpen = signal(false);
const error = signal<string | null>(null);

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    error.value = null;
    return await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return undefined;
  }
}

async function refresh() {
  recording.value = (await run(() => send('rec.state', {}))) ?? null;
  guides.value = (await run(() => send('guide.list', {})))?.guides ?? [];
}

export function Recorder({ tabId }: { tabId: number | null }) {
  useEffect(() => {
    void refresh();
    // The panel is a trusted context and may watch session storage directly.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && 'recording' in changes) recording.value = (changes.recording!.newValue as RecordingState | undefined) ?? null;
      if (area === 'local' && 'guides:index' in changes) void refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

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
            void run(async () => {
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
        {guides.value.length > 0 && (
          <>
            <h2>Guides</h2>
            <ul class="guides">
              {guides.value.map((g) => (
                <li key={g.id}>
                  {g.title} <span class="muted">· {g.steps} steps</span>
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
          <button type="button" data-testid="pause" onClick={() => void run(() => send('rec.pause', {}))}>
            Pause
          </button>
        ) : (
          <button type="button" data-testid="resume" onClick={() => void run(() => send('rec.resume', {}))}>
            Resume
          </button>
        )}
        <button type="button" data-testid="undo" disabled={!r.steps.length} onClick={() => void run(() => send('rec.undo', {}))}>
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
            void run(async () => {
              const res = await send('rec.stop', {});
              recording.value = null;
              if (res) saved.value = { title: res.title, count: res.steps.length };
              await refresh();
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
            void run(async () => {
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
