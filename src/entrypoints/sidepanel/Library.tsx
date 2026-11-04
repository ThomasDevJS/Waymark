/**
 * Guide library in the side panel (SPEC: Discovery, "Side panel": "For this page" first, then
 * all guides with search over title, description, tags and step titles; Sharing: export with a
 * review, import with the import rules, one Allow request for a pack's sites).
 */
import { signal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { Guide } from '../../core/model/schema';
import { guideMatchesUrl } from '../../core/discovery/match';
import { buildSearch, searchGuides } from '../../core/discovery/search';
import type { Choice, Conflict } from '../../core/sharing/pack';
import { originToMatchPattern } from '../../core/url/url';
import { ExportReview } from './ExportReview';

const all = signal<Guide[]>([]);
const query = signal('');
const selected = signal<Set<string>>(new Set());
const exporting = signal<Guide[] | null>(null);
const importState = signal<{ text: string; guides: { id: string; title: string; steps: number }[]; conflicts: Conflict[]; choices: Record<string, Choice>; origins: string[] } | null>(null);
const pending = signal<string[]>([]);
/** Sites the user unticked in the Allow banner (D47: every site is shown and can be left out). */
const unticked = signal<Set<string>>(new Set());
const message = signal<string | null>(null);
const error = signal<string | null>(null);

async function load() {
  try {
    all.value = (await send('guide.all', {})).guides;
    pending.value = (await send('allow.pending', {})).origins;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
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

/** The sites one Allow click requests: every listed site the user left ticked. */
export function originsToAllow(pendingOrigins: string[], untickedOrigins: Set<string>): string[] {
  return pendingOrigins.filter((o) => !untickedOrigins.has(o));
}

/** One Allow request for the ticked sites a pack or library uses (needs this click: SPEC A15). */
async function allowAll() {
  const origins = originsToAllow(pending.value, unticked.value);
  if (!origins.length) return;
  const ok = await chrome.permissions.request({ origins: origins.map(originToMatchPattern) }).catch(() => false);
  // Unticked sites count as "Not now".
  if (ok) await send('allow.dismiss', {});
  unticked.value = new Set();
  await load();
}

async function readFile(file: File) {
  message.value = null;
  if (file.size > 5 * 1024 * 1024) {
    error.value = 'This pack is larger than 5 MB.';
    return;
  }
  const text = await file.text();
  const check = await attempt(() => send('pack.check', { text }));
  if (!check) return;
  if (!check.ok) {
    error.value = check.error ?? 'This file is not a Waymark pack.';
    return;
  }
  importState.value = { text, guides: check.guides, conflicts: check.conflicts, choices: Object.fromEntries(check.conflicts.map((c) => [c.id, 'keep' as Choice])), origins: check.origins };
}

/** A link to the guide's start page that offers the guide (SPEC: Discovery, "Deep link"). */
export function deepLinkFor(g: Guide): string {
  const u = new URL(g.startUrl);
  u.searchParams.set('waymark', g.id);
  return u.href;
}

export function Library({ tabId, tabUrl, onEdit, onStart }: { tabId: number | null; tabUrl: string | null; onEdit: (id: string) => void; onStart: (id: string) => void }) {
  useEffect(() => {
    void load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && ('guides:index' in changes || 'pendingAllow' in changes)) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const index = useMemo(() => buildSearch(all.value), [all.value]);
  const ids = searchGuides(index, all.value, query.value);
  const byId = new Map(all.value.map((g) => [g.id, g]));
  const results = ids.map((id) => byId.get(id)).filter((g): g is Guide => !!g);
  const forPage = tabUrl ? results.filter((g) => guideMatchesUrl(g, tabUrl)) : [];
  const others = results.filter((g) => !forPage.includes(g));

  if (exporting.value) {
    return <ExportReview guides={exporting.value} onDone={() => (exporting.value = null)} />;
  }

  const item = (g: Guide) => (
    <li key={g.id} class="row" data-testid={`guide-${g.id}`}>
      <input
        type="checkbox"
        aria-label={`Select ${g.title} for export`}
        checked={selected.value.has(g.id)}
        onChange={(e) => {
          const next = new Set(selected.value);
          if ((e.target as HTMLInputElement).checked) next.add(g.id);
          else next.delete(g.id);
          selected.value = next;
        }}
      />
      <span class="grow">
        {g.title}{' '}
        <span class="muted">
          · {g.steps.length} steps{g.source === 'library' ? ' · team library' : ''}
        </span>
      </span>
      {g.source === 'library' ? (
        <button type="button" data-testid={`duplicate-${g.id}`} onClick={() => void attempt(async () => onEdit((await send('guide.duplicate', { id: g.id })).id))}>
          Duplicate
        </button>
      ) : (
        <button type="button" data-testid={`edit-${g.id}`} onClick={() => onEdit(g.id)}>
          Edit
        </button>
      )}
      <button
        type="button"
        data-testid={`link-${g.id}`}
        title="Copy a link that offers this guide when opened"
        onClick={() => {
          const link = deepLinkFor(g);
          void navigator.clipboard.writeText(link).then(
            () => (message.value = 'Link copied. Opening it offers to start the guide.'),
            () => (message.value = link),
          );
        }}
      >
        Copy link
      </button>
      <button type="button" data-testid={`start-${g.id}`} disabled={tabId === null} onClick={() => onStart(g.id)}>
        Start
      </button>
    </li>
  );

  const imp = importState.value;
  return (
    <>
      {pending.value.length > 0 && (
        <div class="row banner" role="status" data-testid="allow-banner">
          <div class="grow">
            Your guides run on {pending.value.length === 1 ? 'this site' : `these ${pending.value.length} sites`}. Allow Waymark there to see and play them.
            <ul class="sites" data-testid="allow-sites">
              {pending.value.map((o) => (
                <li key={o}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!unticked.value.has(o)}
                      onChange={(e) => {
                        const next = new Set(unticked.value);
                        if ((e.target as HTMLInputElement).checked) next.delete(o);
                        else next.add(o);
                        unticked.value = next;
                      }}
                    />{' '}
                    {o}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <button type="button" class="primary" data-testid="allow-all" disabled={!originsToAllow(pending.value, unticked.value).length} onClick={() => void allowAll()}>
            Allow
          </button>
          <button type="button" onClick={() => void send('allow.dismiss', {}).then(load)}>
            Not now
          </button>
        </div>
      )}
      {imp && (
        <div class="site" role="dialog" aria-label="Import pack" data-testid="import-dialog">
          <strong>Import {imp.guides.length === 1 ? '1 guide' : `${imp.guides.length} guides`}</strong>
          <ul class="guides">
            {imp.guides.map((g) => (
              <li key={g.id}>
                {g.title} <span class="muted">· {g.steps} steps</span>
              </li>
            ))}
          </ul>
          {imp.origins.length > 0 && (
            <p class="muted" data-testid="import-sites">
              Runs on: {imp.origins.join(', ')}
            </p>
          )}
          {imp.conflicts.map((c) => (
            <label key={c.id} class="grow">
              <span class="muted">You already have a different copy of “{c.existingTitle}”.</span>
              <select
                data-testid={`conflict-${c.id}`}
                value={imp.choices[c.id]}
                onChange={(e) => (importState.value = { ...imp, choices: { ...imp.choices, [c.id]: (e.target as HTMLSelectElement).value as Choice } })}
              >
                <option value="keep">Keep mine</option>
                <option value="replace">Replace mine with the imported copy</option>
                <option value="both">Keep both</option>
              </select>
            </label>
          ))}
          <div class="row">
            <button
              type="button"
              class="primary"
              data-testid="import-confirm"
              onClick={() =>
                void attempt(async () => {
                  const r = await send('pack.import', { text: imp.text, choices: imp.choices });
                  importState.value = null;
                  message.value = `Imported ${r.imported} ${r.imported === 1 ? 'guide' : 'guides'}${r.skipped ? `, ${r.skipped} already up to date or kept` : ''}.`;
                  await load();
                })
              }
            >
              Import
            </button>
            <button type="button" onClick={() => (importState.value = null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <label class="grow">
        <span class="muted">Search guides</span>
        <input type="search" data-testid="search" placeholder="Title, tag or step…" value={query.value} onInput={(e) => (query.value = (e.target as HTMLInputElement).value)} />
      </label>
      {forPage.length > 0 && (
        <>
          <h2>For this page</h2>
          <ul class="guides" data-testid="for-this-page">
            {forPage.map(item)}
          </ul>
        </>
      )}
      <h2>{forPage.length ? 'All guides' : 'Guides'}</h2>
      {others.length ? (
        <ul class="guides" data-testid="all-guides">
          {others.map(item)}
        </ul>
      ) : (
        <p class="muted">{query.value ? 'No guides match.' : all.value.length ? '' : 'No guides yet. Record one, or import a pack.'}</p>
      )}
      <div class="row">
        <button
          type="button"
          data-testid="export"
          disabled={selected.value.size === 0}
          onClick={() => (exporting.value = all.value.filter((g) => selected.value.has(g.id)))}
        >
          Export {selected.value.size ? `${selected.value.size} selected` : 'selected'}…
        </button>
        <label class="button-like">
          Import pack…
          <input
            type="file"
            accept=".json,.waymark.json,application/json"
            data-testid="import-file"
            class="visually-hidden"
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) void readFile(f);
              (e.target as HTMLInputElement).value = '';
            }}
          />
        </label>
        {selected.value.size === 1 && (
          <button
            type="button"
            data-testid="delete-selected"
            onClick={() => {
              const id = [...selected.value][0]!;
              const g = byId.get(id);
              if (g && confirm(`Delete “${g.title}”? This cannot be undone.`)) {
                void attempt(async () => {
                  await send('guide.delete', { id });
                  selected.value = new Set();
                  await load();
                });
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
      {message.value && <p role="status" data-testid="library-message">{message.value}</p>}
      {error.value && <p role="alert">{error.value}</p>}
    </>
  );
}
