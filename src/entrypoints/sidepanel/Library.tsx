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
import { useFlipList } from '../../ui/useMotion';
import { stepChoices, tagChips, withTags } from '../../core/discovery/tags';
import { PAGE_SEARCH_FROM, pageTagChips } from '../../core/discovery/page-search';
import { showToast, ToastSlot, toast } from './Toast';
import { UNDO_MS } from '../../core/storage/trash';
import { HelpTip } from './Help';

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
/** Guides already finished when the list was shown: their badge doesn't pop (D131). */
let completedAtOpen: Set<string> | null = null;
/** Selected tag chips (D102): a guide must carry all of them. */
const tagFilter = signal<string[]>([]);
/** The "For this page" filter, shown from PAGE_SEARCH_FROM guides for the page (D170). */
const pageQuery = signal('');
const pageTags = signal<string[]>([]);
/** The page those filters were typed on: another page starts unfiltered. */
let pageFilterUrl: string | null = null;
/** The guide whose "More" actions are open. */
const moreOpen = signal<string | null>(null);
/** Export picks guides with checkboxes, shown only while choosing (D124). */
const selecting = signal(false);
/** "Start from step" choice per guide (0-based). */
const startFrom = signal<Record<string, number>>({});

async function load() {
  try {
    all.value = (await send('guide.list', {})).guides;
    pending.value = (await send('allow.pending', {})).origins;
    completed.value = (await send('completions.list', {})).completed;
    completedAtOpen ??= new Set(Object.keys(completed.value));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** Deletes whose toast this panel already showed (and the user dismissed or used): not shown again. */
const shownUndo = new Set<string>();

/** A panel opened during the undo window shows the Undo toast again (D100). */
async function resumeUndo() {
  const items = (await send('trash.list', {}).catch(() => ({ items: [] }))).items;
  const last = items[items.length - 1];
  if (last && !toast.value && !shownUndo.has(`${last.id}@${last.deletedAt}`)) undoToast(last.id, last.title, last.undoUntil, false, last.deletedAt);
}

/** After Undo, focus goes to the restored guide's Start button (the toast's button is gone). */
function focusGuide(id: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="start-${CSS.escape(id)}"]`)?.focus());
}

function undoToast(id: string, title: string, until: number, focus: boolean, deletedAt = until - UNDO_MS) {
  shownUndo.add(`${id}@${deletedAt}`);
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
        if (r?.ok) focusGuide(id);
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
    error.value = 'This file is larger than 5 MB.';
    return;
  }
  const text = await file.text();
  const check = await attempt(() => send('pack.check', { text }));
  if (!check) return;
  if (!check.ok) {
    error.value = check.error ?? 'This file is not a Waymark guide file.';
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

/** Export… shows checkboxes; focus goes to the bar, which says what to do (the button that was pressed is gone). */
function startSelecting() {
  selecting.value = true;
  requestAnimationFrame(() => document.getElementById('select-bar')?.focus());
}

function endSelecting() {
  selecting.value = false;
  selected.value = new Set();
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="export"]')?.focus());
}

/** Share… in a guide's More menu: the export review for that one guide. */
async function shareOne(id: string) {
  const r = await attempt(() => send('guide.many', { ids: [id] }));
  if (!r) return;
  moreOpen.value = null;
  exporting.value = r.guides;
}

export function Library({ tabId, tabUrl, onEdit, onStart }: { tabId: number | null; tabUrl: string | null; onEdit: (id: string) => void; onStart: (id: string, stepIndex?: number) => void }) {
  useEffect(() => {
    completedAtOpen = null; // re-read on this mount: returning from the editor pops nothing
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
  const forPageAll = tabUrl ? results.filter((g) => guideMatchesUrl(g, tabUrl)) : [];
  const others = results.filter((g) => !forPageAll.includes(g));
  // Many guides for this page (D170): a box and up to three chips narrow that section only, with
  // the library's own search index and tag rule. The count is of the page's guides, not of the
  // guides the main search left.
  if (pageFilterUrl !== tabUrl) {
    pageFilterUrl = tabUrl;
    pageQuery.value = '';
    pageTags.value = [];
  }
  const pageCount = tabUrl ? all.value.filter((g) => guideMatchesUrl(g, tabUrl)).length : 0;
  const pageSearch = pageCount >= PAGE_SEARCH_FROM;
  const pageChips = useMemo(() => (tabUrl ? pageTagChips(all.value.filter((g) => guideMatchesUrl(g, tabUrl))) : []), [all.value, tabUrl]);
  const pageActiveTags = pageSearch ? pageTags.value.filter((t) => pageChips.some((c) => c.toLocaleLowerCase() === t.toLocaleLowerCase())) : [];
  const pageFiltering = pageSearch && (!!pageQuery.value.trim() || pageActiveTags.length > 0);
  const forPage = pageFiltering
    ? withTags(
        searchGuides(index, all.value, pageQuery.value)
          .map((id) => forPageAll.find((g) => g.id === id))
          .filter((g): g is GuideIndexEntry => !!g),
        pageActiveTags,
      )
    : forPageAll;
  // "Select all" picks the guides on screen, never ones hidden by search, tags or the page filter.
  const onScreen = [...forPage, ...others];
  const allShown = onScreen.length > 0 && onScreen.every((g) => selected.value.has(g.id));
  // Rows that appear (Undo, a filter) rise in (D131). They never glide: search results are
  // sorted by score, so the order changes as you type, and rows must not slide under the cursor.
  const pageFlip = useFlipList<HTMLUListElement>(forPage.map((g) => g.id), { glide: false });
  const otherFlip = useFlipList<HTMLUListElement>(others.map((g) => g.id), { glide: false });

  if (exporting.value) {
    return (
      <ExportReview
        guides={exporting.value}
        onDone={() => {
          exporting.value = null;
          endSelecting();
        }}
      />
    );
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

  const item = (g: GuideIndexEntry, flip: { enter: (key: string) => string }) => {
    const done = completed.value[g.id];
    const open = moreOpen.value === g.id;
    // The guide may have fewer steps than when the choice was made.
    const from = Math.min(startFrom.value[g.id] ?? 0, Math.max(0, g.steps - 1));
    const moreId = `more-${g.id}`;
    return (
      <li key={g.id} class={`guide-item lift ${flip.enter(g.id)}${open ? ' open' : ''}`} data-flip={g.id} data-testid={`guide-${g.id}`}>
        <div class="guide-row">
          {selecting.value && (
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
          )}
          <div class="guide-main">
            <span class="guide-title">{g.title}</span>
            <span class="guide-meta">
              <span class="count">
                {g.steps} {g.steps === 1 ? 'step' : 'steps'}
              </span>
              {done && (
                <span class="badge success" data-testid={`completed-${g.id}`} title={`Finished ${new Date(done).toLocaleString()}`}>
                  <Icon name="check" class={completedAtOpen?.has(g.id) ? undefined : 'tick'} />
                  Completed
                </span>
              )}
              {g.source === 'library' && <span class="badge accent">Team</span>}
            </span>
          </div>
          <div class="guide-actions">
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
              <button type="button" class="ghost sm" data-testid={`edit-${g.id}`} aria-label={`Edit ${g.title}`} onClick={() => onEdit(g.id)}>
                <Icon name="edit" />
                Edit
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
          <div class="guide-more unfold" id={moreId} data-testid={`more-panel-${g.id}`}>
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
              <button type="button" class="sm" data-testid={`share-${g.id}`} onClick={() => void shareOne(g.id)}>
                <Icon name="share" />
                Share…
              </button>
              <button type="button" class="sm" data-testid={`link-${g.id}`} title="Opening the link offers this guide" onClick={() => copyLink(g)}>
                <Icon name="link" />
                Copy link
              </button>
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
      {forPageAll.length > 0 && (
        <section class="stack-sm" aria-labelledby="for-page-label">
          <h2 class="section-label" id="for-page-label" tabIndex={-1}>
            <Icon name="pin" />
            For this page <span class="badge accent">{forPageAll.length}</span>
          </h2>
          {pageSearch && (
            <div class="stack-sm page-filter">
              <div class="search">
                <Icon name="search" />
                <input
                  type="search"
                  data-testid="page-search"
                  aria-label="Search the guides for this page"
                  aria-controls="for-this-page-list"
                  placeholder="Search the guides for this page"
                  value={pageQuery.value}
                  onInput={(e) => (pageQuery.value = (e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    // Esc clears first (the box's own clear), and only then goes on to the panel.
                    if (e.key === 'Escape' && (pageQuery.value || pageTags.value.length)) {
                      e.preventDefault();
                      e.stopPropagation();
                      pageQuery.value = '';
                      pageTags.value = [];
                    }
                  }}
                />
              </div>
              {pageChips.length > 0 && (
                <div class="chips" role="group" aria-label="Filter the guides for this page by tag" data-testid="page-tag-chips">
                  <Icon name="tag" />
                  {pageChips.map((tag) => {
                    const on = pageActiveTags.some((t) => t.toLocaleLowerCase() === tag.toLocaleLowerCase());
                    return (
                      <button
                        type="button"
                        key={tag}
                        class={`chip${on ? ' on' : ''}`}
                        aria-pressed={on}
                        data-testid={`page-tag-${tag}`}
                        onClick={() => (pageTags.value = on ? pageActiveTags.filter((t) => t.toLocaleLowerCase() !== tag.toLocaleLowerCase()) : [...pageActiveTags, tag])}
                      >
                        {on && <Icon name="check" />}
                        {tag}
                      </button>
                    );
                  })}
                </div>
              )}
              <p class={forPage.length ? 'visually-hidden' : 'small muted'} role="status" data-testid="page-search-status">
                {!pageFiltering ? '' : forPage.length ? `${forPage.length} of ${forPageAll.length} guides for this page` : 'No guides match'}
              </p>
            </div>
          )}
          <ul class="guide-list" id="for-this-page-list" data-testid="for-this-page" ref={pageFlip.ref} hidden={!forPage.length}>
            {forPage.map((g) => item(g, pageFlip))}
          </ul>
        </section>
      )}
      {(others.length > 0 || !forPageAll.length) && (
        <section class="stack-sm" aria-labelledby="all-label">
          <h2 class="section-label" id="all-label" tabIndex={-1}>
            <Icon name="library" />
            {forPageAll.length ? 'Other guides' : 'All guides'}
            {others.length > 0 && <span class="badge">{others.length}</span>}
          </h2>
          {others.length ? (
            <ul class="guide-list" data-testid="all-guides" ref={otherFlip.ref}>
              {others.map((g) => item(g, otherFlip))}
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
              <span class="small">{tabId === null ? 'A guide walks someone through a task, one highlighted step at a time. Allow Waymark on a site to record one, or import a guide file someone sent you.' : 'A guide walks someone through a task, one highlighted step at a time. Record one above, import a guide file someone sent you, or try a tutorial to see one play.'}</span>
            </div>
          ) : null}
        </section>
      )}
      {selecting.value ? (
        <div class="banner select-bar" role="group" aria-labelledby="select-bar-text" id="select-bar" tabIndex={-1} data-testid="select-bar">
          <Icon name="download" />
          <div class="grow stack-sm">
            <span id="select-bar-text">Select the guides to export, then press Export.</span>
            <div class="row">
              <button
                type="button"
                class="primary sm"
                data-testid="export-selected"
                disabled={selected.value.size === 0}
                onClick={() => void attempt(async () => (exporting.value = (await send('guide.many', { ids: all.value.map((g) => g.id).filter((id) => selected.value.has(id)) })).guides))}
              >
                Export {selected.value.size ? `${selected.value.size} selected` : 'selected'}…
              </button>
              <button
                type="button"
                class="ghost sm"
                data-testid="select-all"
                onClick={() => (selected.value = allShown ? new Set() : new Set(onScreen.map((g) => g.id)))}
              >
                {allShown ? 'Select none' : onScreen.length === all.value.length ? 'Select all' : `Select all ${onScreen.length} shown`}
              </button>
              <button
                type="button"
                class="ghost sm push"
                data-testid="select-cancel"
                onClick={endSelecting}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div class="toolbar library-actions">
          {all.value.length > 0 && (
            <button type="button" data-testid="export" onClick={startSelecting}>
              <Icon name="download" />
              Export…
            </button>
          )}
          <label class="btn">
            <Icon name="upload" />
            Import…
            <input
              type="file"
              accept=".json,.waymark.json,application/json"
              data-testid="import-file"
              aria-label="Import a guide file"
              class="visually-hidden"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) void readFile(f);
                (e.target as HTMLInputElement).value = '';
              }}
            />
          </label>
          <HelpTip label="About sharing guides" testid="help-share">
            Export saves guides to a file (or a printable how-to) that you can send. Import adds guides from such a file. To share one guide quickly, use Copy link in its ⋯ menu. A team can also publish a file at a web address: see Settings → Team library.
          </HelpTip>
        </div>
      )}
      {message.value && (
        <p class="status-text ok" role="status" data-testid="library-message">
          {/^(Link copied|Restored|Made a copy|Imported [1-9])/.test(message.value) && <Icon key={message.value} name="check" class="tick" />}
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
