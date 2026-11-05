/**
 * Guide library in the side panel (SPEC: Discovery, "Side panel": "For this page" first, then
 * all guides with search over title, description, tags and step titles; Sharing: export with a
 * review, import with the import rules, one Allow request for a pack's sites).
 */
import { signal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { Guide } from '../../core/model/schema';
import type { GuideIndexEntry } from '../../core/storage/guides';
import { guideMatchesUrl } from '../../core/discovery/match';
import { buildSearch, searchGuides } from '../../core/discovery/search';
import type { Choice, Conflict } from '../../core/sharing/pack';
import { originToMatchPattern } from '../../core/url/url';
import { ExportReview } from './ExportReview';
import { Icon } from '../../ui/Icon';
import { stepChoices, tagChips, withTags } from '../../core/discovery/tags';
import { showToast, ToastSlot, toast } from './Toast';

/** The guide index (D49): the list, search and "For this page" never need full guides. */
const all = signal<GuideIndexEntry[]>([]);
const query = signal('');
const selected = signal<Set<string>>(new Set());
const exporting = signal<Guide[] | null>(null);
const importState = signal<{ text: string; guides: { id: string; title: string; steps: number }[]; conflicts: Conflict[]; choices: Record<string, Choice>; origins: string[] } | null>(null);
const pending = signal<string[]>([]);
/** Sites the user unticked in the Allow banner (D48: every site is shown and can be left out). */
const unticked = signal<Set<string>>(new Set());
const message = signal<string | null>(null);
const error = signal<string | null>(null);
/** Guide id → when the learner last finished it (D101). */
const completed = signal<Record<string, string>>({});
/** Selected tag chips (D102): a guide must carry all of them. */
const tagFilter = signal<string[]>([]);
/** The guide whose "More" actions are open. */
const moreOpen = signal<string | null>(null);
/** "Start from step" choice per guide (0-based). */
const startFrom = signal<Record<string, number>>({});

async function load() {
  try {
    all.value = (await send('guide.list', {})).guides;
    pending.value = (await send('allow.pending', {})).origins;
    completed.value = (await send('completions.list', {})).completed;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** A panel opened during the undo window shows the Undo toast again (D100). */
async function resumeUndo() {
  const items = (await send('trash.list', {}).catch(() => ({ items: [] }))).items;
  const last = items[items.length - 1];
  if (last && !toast.value) undoToast(last.id, last.title, last.undoUntil, false);
}

function undoToast(id: string, title: string, until: number, focus: boolean) {
  showToast({
    scope: 'library',
    text: `Deleted “${title}”.`,
    until,
    focus,
    testid: 'guide-undo-toast',
    fallbackFocus: () => document.getElementById('all-label') ?? document.getElementById('for-page-label'),
    action: {
      label: 'Undo',
      run: async () => {
        const r = await attempt(() => send('guide.restore', { id }));
        if (r && !r.ok) error.value = r.error ?? 'Could not undo.';
        if (r?.ok) message.value = `Restored “${title}”.`;
        await load();
      },
    },
  });
}

/** Deletes at once; the guide waits in the trash for Undo (D100). */
async function deleteGuide(g: Pick<GuideIndexEntry, 'id' | 'title'>) {
  const r = await attempt(() => send('guide.delete', { id: g.id }));
  if (!r) return;
  const next = new Set(selected.value);
  next.delete(g.id);
  selected.value = next;
  moreOpen.value = null;
  message.value = null;
  await load();
  if (r.undoUntil) undoToast(g.id, g.title, r.undoUntil, true);
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

/**
 * Only the conflicts the user changed: a missing choice means "keep" (planImport), so the message
 * stays small however many guides clash (D53).
 */
export function changedChoices(choices: Record<string, Choice>): Record<string, Choice> {
  return Object.fromEntries(Object.entries(choices).filter(([, c]) => c !== 'keep'));
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
  if (ok) {
    await send('site.allowed', { origins });
    await send('allow.dismiss', {});
  }
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

/** Moves focus into the import dialog when it opens, so keyboard and screen reader users land on it. */
function focusOnMount(el: HTMLElement | null) {
  if (el && !el.dataset.focused) {
    el.dataset.focused = '1';
    el.focus();
  }
}

/** A link to the guide's start page that offers the guide (SPEC: Discovery, "Deep link"). */
export function deepLinkFor(g: Pick<Guide, 'id' | 'startUrl'>): string | null {
  let u: URL;
  try {
    u = new URL(g.startUrl);
  } catch {
    return null;
  }
  u.searchParams.set('waymark', g.id);
  return u.href;
}

export function Library({ tabId, tabUrl, onEdit, onStart }: { tabId: number | null; tabUrl: string | null; onEdit: (id: string) => void; onStart: (id: string, stepIndex?: number) => void }) {
  useEffect(() => {
    void load().then(resumeUndo);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && ('guides:index' in changes || 'pendingAllow' in changes || 'completions' in changes)) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const index = useMemo(() => buildSearch(all.value), [all.value]);
  const chips = useMemo(() => tagChips(all.value), [all.value]);
  // A chip whose last guide went away stops filtering.
  const activeTags = tagFilter.value.filter((t) => chips.some((c) => c.tag.toLocaleLowerCase() === t.toLocaleLowerCase()));
  const ids = searchGuides(index, all.value, query.value);
  const byId = new Map(all.value.map((g) => [g.id, g]));
  const results = withTags(
    ids.map((id) => byId.get(id)).filter((g): g is GuideIndexEntry => !!g),
    activeTags,
  );
  const forPage = tabUrl ? results.filter((g) => guideMatchesUrl(g, tabUrl)) : [];
  const others = results.filter((g) => !forPage.includes(g));

  if (exporting.value) {
    return <ExportReview guides={exporting.value} onDone={() => (exporting.value = null)} />;
  }

  const copyLink = (g: GuideIndexEntry) => {
    const link = deepLinkFor(g);
    if (!link) {
      error.value = 'This guide has no start page to link to.';
      return;
    }
    void navigator.clipboard.writeText(link).then(
      () => (message.value = 'Link copied. Opening it offers to start the guide.'),
      () => (message.value = link),
    );
  };

  const item = (g: GuideIndexEntry) => {
    const done = completed.value[g.id];
    const open = moreOpen.value === g.id;
    const from = startFrom.value[g.id] ?? 0;
    const moreId = `more-${g.id}`;
    return (
      <li key={g.id} class={`guide-item${open ? ' open' : ''}`} data-testid={`guide-${g.id}`}>
        <div class="guide-row">
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
          <div class="guide-main">
            <span class="guide-title">{g.title}</span>
            <span class="guide-meta">
              <span class="count">
                {g.steps} {g.steps === 1 ? 'step' : 'steps'}
              </span>
              {done && (
                <span class="badge success" data-testid={`completed-${g.id}`} title={`Finished ${new Date(done).toLocaleString()}`}>
                  <Icon name="check" />
                  Completed
                </span>
              )}
              {g.source === 'library' && <span class="badge accent">Team</span>}
            </span>
          </div>
          <div class="guide-actions">
            <button type="button" class="ghost icon sm" data-testid={`link-${g.id}`} aria-label={`Copy link to ${g.title}`} title="Copy link: opening it offers this guide" onClick={() => copyLink(g)}>
              <Icon name="link" />
            </button>
            {g.source === 'library' ? (
              <button
                type="button"
                class="ghost icon sm"
                data-testid={`duplicate-${g.id}`}
                aria-label={`Duplicate ${g.title} to edit it`}
                title="Duplicate to edit"
                onClick={() => void attempt(async () => onEdit((await send('guide.duplicate', { id: g.id })).id))}
              >
                <Icon name="copy" />
              </button>
            ) : (
              <button type="button" class="ghost icon sm" data-testid={`edit-${g.id}`} aria-label={`Edit ${g.title}`} title="Edit" onClick={() => onEdit(g.id)}>
                <Icon name="edit" />
              </button>
            )}
            <button
              type="button"
              class="ghost icon sm"
              data-testid={`more-${g.id}`}
              aria-label={`More actions for ${g.title}`}
              title="More"
              aria-expanded={open}
              aria-controls={open ? moreId : undefined}
              onClick={() => (moreOpen.value = open ? null : g.id)}
            >
              <Icon name="more" />
            </button>
            <button
              type="button"
              class="sm start"
              data-testid={`start-${g.id}`}
              disabled={tabId === null}
              aria-label={`${done ? 'Restart' : 'Start'} ${g.title}`}
              title={tabId === null ? 'Allow Waymark on this site to play guides' : undefined}
              onClick={() => onStart(g.id)}
            >
              <Icon name={done ? 'restart' : 'play'} />
              {done ? 'Restart' : 'Start'}
            </button>
          </div>
        </div>
        {open && (
          <div class="guide-more" id={moreId} data-testid={`more-panel-${g.id}`}>
            {g.steps > 1 && (
              <div class="row nowrap">
                <label class="inline-field grow">
                  <span class="label">Start from</span>
                  <select
                    data-testid={`start-from-${g.id}`}
                    value={String(from)}
                    onChange={(e) => (startFrom.value = { ...startFrom.value, [g.id]: Number((e.target as HTMLSelectElement).value) })}
                  >
                    {stepChoices(g).map((c) => (
                      <option key={c.index} value={String(c.index)}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" class="sm primary" data-testid={`start-step-${g.id}`} disabled={tabId === null} onClick={() => onStart(g.id, from)}>
                  <Icon name="play" />
                  Start from step {from + 1}
                </button>
              </div>
            )}
            <div class="toolbar">
              {g.source === 'local' && (
                <button
                  type="button"
                  class="sm"
                  data-testid={`duplicate-guide-${g.id}`}
                  onClick={() =>
                    void attempt(async () => {
                      const copy = await send('guide.duplicate', { id: g.id });
                      moreOpen.value = null;
                      message.value = `Made a copy: “${copy.title}”.`;
                      await load();
                    })
                  }
                >
                  <Icon name="duplicate" />
                  Duplicate
                </button>
              )}
              <button type="button" class="sm danger" data-testid={`delete-${g.id}`} onClick={() => void deleteGuide(g)}>
                <Icon name="trash" />
                Delete
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  const imp = importState.value;
  return (
    <>
      {pending.value.length > 0 && (
        <div class="banner" role="status" data-testid="allow-banner">
          <Icon name="shield" />
          <div class="grow stack-sm">
            <span>Your guides run on {pending.value.length === 1 ? 'this site' : `these ${pending.value.length} sites`}. Allow Waymark there to see and play them.</span>
            <ul class="sites" data-testid="allow-sites">
              {pending.value.map((o) => (
                <li key={o}>
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={!unticked.value.has(o)}
                      onChange={(e) => {
                        const next = new Set(unticked.value);
                        if ((e.target as HTMLInputElement).checked) next.delete(o);
                        else next.add(o);
                        unticked.value = next;
                      }}
                    />
                    <span class="mono small">{o}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div class="row">
              <button type="button" class="primary sm" data-testid="allow-all" disabled={!originsToAllow(pending.value, unticked.value).length} onClick={() => void allowAll()}>
                Allow
              </button>
              <button type="button" class="ghost sm" onClick={() => void send('allow.dismiss', {}).then(load)}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
      {imp && (
        <div class="card flat import" role="dialog" aria-labelledby="import-title" data-testid="import-dialog">
          <h2 id="import-title" tabIndex={-1} ref={focusOnMount}>Import {imp.guides.length === 1 ? '1 guide' : `${imp.guides.length} guides`}</h2>
          <ul class="list">
            {imp.guides.map((g) => (
              <li key={g.id} class="list-item">
                <Icon name="book" />
                <span class="grow">{g.title}</span>
                <span class="muted small">
                  {g.steps} {g.steps === 1 ? 'step' : 'steps'}
                </span>
              </li>
            ))}
          </ul>
          {imp.origins.length > 0 && (
            <p class="small muted" data-testid="import-sites">
              Runs on: <span class="mono">{imp.origins.join(', ')}</span>
            </p>
          )}
          {imp.conflicts.map((c) => (
            <label key={c.id} class="field">
              <span class="label">You already have a different copy of “{c.existingTitle}”.</span>
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
                  const r = await send('pack.import', { text: imp.text, choices: changedChoices(imp.choices) });
                  importState.value = null;
                  message.value = `Imported ${r.imported} ${r.imported === 1 ? 'guide' : 'guides'}${r.skipped ? `, ${r.skipped} already up to date or kept` : ''}.`;
                  await load();
                })
              }
            >
              Import
            </button>
            <button type="button" class="ghost" onClick={() => (importState.value = null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {all.value.length > 0 && (
        <div class="search">
          <Icon name="search" />
          <input
            type="search"
            data-testid="search"
            aria-label="Search guides"
            placeholder="Search guides, tags and steps"
            value={query.value}
            onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
          />
        </div>
      )}
      {chips.length > 0 && (
        <div class="chips" role="group" aria-label="Filter by tag" data-testid="tag-chips">
          <Icon name="tag" />
          {chips.map((c) => {
            const on = activeTags.some((t) => t.toLocaleLowerCase() === c.tag.toLocaleLowerCase());
            return (
              <button
                type="button"
                key={c.tag}
                class={`chip${on ? ' on' : ''}`}
                aria-pressed={on}
                data-testid={`tag-${c.tag}`}
                onClick={() => (tagFilter.value = on ? activeTags.filter((t) => t.toLocaleLowerCase() !== c.tag.toLocaleLowerCase()) : [...activeTags, c.tag])}
              >
                {on && <Icon name="check" />}
                {c.tag}
                <span class="chip-count" aria-label={`${c.count} ${c.count === 1 ? 'guide' : 'guides'}`}>
                  {c.count}
                </span>
              </button>
            );
          })}
          {activeTags.length > 0 && (
            <button type="button" class="ghost sm" data-testid="clear-tags" onClick={() => (tagFilter.value = [])}>
              Clear
            </button>
          )}
        </div>
      )}
      {forPage.length > 0 && (
        <section class="stack-sm" aria-labelledby="for-page-label">
          <h2 class="section-label" id="for-page-label">
            <Icon name="pin" />
            For this page <span class="badge accent">{forPage.length}</span>
          </h2>
          <ul class="guide-list" data-testid="for-this-page">
            {forPage.map(item)}
          </ul>
        </section>
      )}
      {(others.length > 0 || !forPage.length) && (
        <section class="stack-sm" aria-labelledby="all-label">
          <h2 class="section-label" id="all-label">
            <Icon name="library" />
            {forPage.length ? 'Other guides' : 'All guides'}
            {others.length > 0 && <span class="badge">{others.length}</span>}
          </h2>
          {others.length ? (
            <ul class="guide-list" data-testid="all-guides">
              {others.map(item)}
            </ul>
          ) : query.value || activeTags.length ? (
            <div class="empty" data-testid="no-match">
              <Icon name="search" />
              <strong>{query.value ? `No guides match “${query.value}”` : 'No guides have all these tags'}</strong>
              <span class="small">{activeTags.length ? `Filtered by ${activeTags.join(', ')}. ` : ''}Search looks in titles, tags and step titles.</span>
            </div>
          ) : !all.value.length ? (
            <div class="empty">
              <Icon name="book" />
              <strong>No guides yet</strong>
              <span class="small">Record one above, or import a pack someone shared with you.</span>
            </div>
          ) : null}
        </section>
      )}
      <div class="toolbar library-actions">
        {all.value.length > 0 && (
          <button
            type="button"
            data-testid="export"
            disabled={selected.value.size === 0}
            onClick={() => void attempt(async () => (exporting.value = (await send('guide.many', { ids: all.value.map((g) => g.id).filter((id) => selected.value.has(id)) })).guides))}
          >
            <Icon name="download" />
            Export {selected.value.size ? `${selected.value.size} selected` : 'selected'}…
          </button>
        )}
        <label class="btn">
          <Icon name="upload" />
          Import…
          <input
            type="file"
            accept=".json,.waymark.json,application/json"
            data-testid="import-file"
            aria-label="Import a guide pack"
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
            class="danger push"
            data-testid="delete-selected"
            onClick={() => {
              const g = byId.get([...selected.value][0]!);
              if (g) void deleteGuide(g);
            }}
          >
            <Icon name="trash" />
            Delete
          </button>
        )}
      </div>
      {all.value.length > 0 && selected.value.size === 0 && <p class="hint">Select guides with their checkboxes to export them.</p>}
      {message.value && (
        <p class="status-text ok" role="status" data-testid="library-message">
          {message.value}
        </p>
      )}
      {error.value && (
        <p class="alert" role="alert">
          <Icon name="error" />
          {error.value}
        </p>
      )}
      <ToastSlot scope="library" />
    </>
  );
}
