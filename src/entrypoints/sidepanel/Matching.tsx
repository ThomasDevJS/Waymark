/**
 * Site options → Advanced matching (issue #97, D213): the author's own site profile. Stable
 * attributes (with Find candidates on this page), ignore patterns, hash routing, query keys to
 * keep. Save tests every step of the site's guides on this page before and after, and the author
 * keeps the change or reverts it. Attribute names and patterns only: values seen by Find
 * candidates are shown here and never stored.
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import type { AttrCandidate, StepCheck } from '../../core/messaging/protocol';
import { profileProblem, type SiteProfile } from '../../core/model/profile';
import { Icon } from '../../ui/Icon';

interface Draft {
  attrs: string;
  patterns: string;
  hash: boolean;
  keys: string;
}

const draft = signal<Draft>({ attrs: '', patterns: '', hash: false, keys: '' });
const saved = signal<SiteProfile | null>(null);
const library = signal<SiteProfile | null>(null);
const candidates = signal<AttrCandidate[] | null>(null);
const busy = signal(false);
const error = signal<string | null>(null);
/** After Save: the before/after test, and the profile to go back to on Revert. */
const outcome = signal<{ before: StepCheck[]; after: StepCheck[]; previous: SiteProfile | null } | null>(null);

const list = (s: string, sep: RegExp) =>
  s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);

function toDraft(p: SiteProfile | null): Draft {
  return { attrs: (p?.stableAttributes ?? []).join(', '), patterns: (p?.ignorePatterns ?? []).join('\n'), hash: !!p?.hashRouting, keys: (p?.keepQueryKeys ?? []).join(', ') };
}

export function fromDraft(origin: string, d: Draft): SiteProfile {
  return { origin, stableAttributes: [...new Set(list(d.attrs, /[,\s]+/))], ignorePatterns: [...new Set(list(d.patterns, /\n+/))], hashRouting: d.hash, keepQueryKeys: [...new Set(list(d.keys, /[,\s]+/))] };
}

/** Counts of a test: found, fragile, not found. */
export function tally(r: StepCheck[]): Record<StepCheck['result'], number> {
  const t = { found: 0, fragile: 0, 'not-found': 0, 'off-page': 0 };
  for (const x of r) t[x.result]++;
  return t;
}

async function load(origin: string) {
  error.value = null;
  candidates.value = null;
  outcome.value = null;
  try {
    const r = await send('profile.site.get', { origin });
    saved.value = r.local;
    library.value = r.library;
    draft.value = toDraft(r.local);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function save(origin: string, tabId: number | null) {
  const next = fromDraft(origin, draft.value);
  const problem = profileProblem(next);
  if (problem) {
    error.value = problem;
    return;
  }
  error.value = null;
  busy.value = true;
  const previous = saved.value;
  try {
    const before = tabId !== null ? (await send('profile.testAll', { tabId, origin, compare: next })).results : [];
    const r = await send('profile.site.set', { origin, profile: next });
    if (!r.ok) {
      error.value = r.error ?? 'Couldn’t save.';
      return;
    }
    saved.value = next;
    const after = tabId !== null ? (await send('profile.testAll', { tabId, origin, compare: previous })).results : [];
    outcome.value = { before, after, previous };
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function revert(origin: string) {
  const o = outcome.value;
  if (!o) return;
  busy.value = true;
  try {
    await send('profile.site.set', { origin, profile: o.previous });
    saved.value = o.previous;
    draft.value = toDraft(o.previous);
    outcome.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function findCandidates(tabId: number) {
  error.value = null;
  try {
    candidates.value = (await send('profile.candidates', { tabId })).candidates;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

const RESULT: Record<StepCheck['result'], string> = { found: 'found', fragile: 'fragile', 'not-found': 'not found', 'off-page': 'no longer on this page' };

export function AdvancedMatching({ origin, tabId }: { origin: string; tabId: number | null }) {
  useEffect(() => {
    void load(origin);
  }, [origin]);
  const d = draft.value;
  const o = outcome.value;
  const set = (patch: Partial<Draft>) => (draft.value = { ...draft.value, ...patch });
  const chosen = new Set(list(d.attrs, /[,\s]+/));
  return (
    <details class="matching stack-sm" data-testid="advanced-matching">
      <summary class="small">Advanced matching</summary>
      <p class="xsmall muted">How Waymark finds elements on this site, for your guides and those you share. Change these only if steps are hard to find.</p>
      {library.value && <p class="xsmall muted" data-testid="matching-library">Your team library sets these options for this site too. Team guides use the library’s; your own guides use yours.</p>}
      <label class="field">
        <span class="label">Stable attributes</span>
        <input data-testid="matching-attrs" value={d.attrs} placeholder="data-automation-id" disabled={busy.value} onInput={(e) => set({ attrs: (e.target as HTMLInputElement).value })} />
        <span class="hint">Attributes this site keeps on purpose for its elements, separated by commas.</span>
      </label>
      {tabId !== null && (
        <div class="row">
          <button type="button" class="ghost sm" data-testid="matching-find" disabled={busy.value} onClick={() => void findCandidates(tabId)}>
            <Icon name="search" />
            Find candidates on this page
          </button>
        </div>
      )}
      {candidates.value && (
        <ul class="list divided" data-testid="matching-candidates">
          {candidates.value.length === 0 && <li class="list-item small muted">No attribute on this page looks like a stable hook.</li>}
          {candidates.value.map((c) => (
            <li key={c.attr} class="list-item">
              <div class="grow">
                <div class="mono small">{c.attr}</div>
                <div class="xsmall muted">
                  {c.elements} elements{c.unique ? ', every value used once' : ''} · for example {c.samples.join(', ')}
                </div>
              </div>
              <button type="button" class="ghost sm" data-testid={`matching-add-${c.attr}`} disabled={chosen.has(c.attr)} onClick={() => set({ attrs: [...chosen, c.attr].join(', ') })}>
                {chosen.has(c.attr) ? 'Added' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label class="field">
        <span class="label">Ignore patterns</span>
        <textarea data-testid="matching-patterns" rows={2} value={d.patterns} placeholder="id=gen-*" disabled={busy.value} onInput={(e) => set({ patterns: (e.target as HTMLTextAreaElement).value })} />
        <span class="hint">Generated values to leave out, one per line. * stands for any characters; put an attribute name and = in front to limit it to that attribute.</span>
      </label>
      <label class="check">
        <input type="checkbox" data-testid="matching-hash" checked={d.hash} disabled={busy.value} onChange={(e) => set({ hash: (e.target as HTMLInputElement).checked })} />
        <span>Pages are after # in the address (hash routing)</span>
      </label>
      <label class="field">
        <span class="label">Query keys to keep</span>
        <input data-testid="matching-keys" value={d.keys} placeholder="tab, view" disabled={busy.value} onInput={(e) => set({ keys: (e.target as HTMLInputElement).value })} />
        <span class="hint">Parts of the address after ? that make a different page, separated by commas.</span>
      </label>
      {error.value && (
        <p class="alert" role="alert" data-testid="matching-error">
          <Icon name="error" />
          {error.value}
        </p>
      )}
      {o ? (
        <div class="stack-sm" role="status" data-testid="matching-outcome">
          {o.before.length === 0 && o.after.length === 0 ? (
            <p class="small">Saved. No step of this site’s guides is on this page, so nothing was tested.</p>
          ) : (
            <>
              <p class="small" data-testid="matching-summary">
                Steps on this page, before → after: {tally(o.before).found} → {tally(o.after).found} found, {tally(o.before).fragile} → {tally(o.after).fragile} fragile, {tally(o.before)['not-found']} → {tally(o.after)['not-found']} not found
                {tally(o.before)['off-page'] + tally(o.after)['off-page'] > 0 ? `, ${tally(o.before)['off-page']} → ${tally(o.after)['off-page']} no longer on this page (their page rules read the address differently)` : ''}.
              </p>
              <ul class="list divided">
                {o.after.map((a) => {
                  const b = o.before.find((x) => x.guideId === a.guideId && x.stepId === a.stepId);
                  return (
                    <li key={`${a.guideId}-${a.stepId}`} class="list-item small">
                      <span class="grow">
                        {a.guideTitle} · step {a.stepIndex + 1}
                      </span>
                      <span class={b && b.result !== a.result ? 'badge warn' : 'badge'}>
                        {b ? `${RESULT[b.result]} → ` : ''}
                        {RESULT[a.result]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div class="row">
            <button type="button" class="primary sm" data-testid="matching-keep" onClick={() => (outcome.value = null)}>
              Keep
            </button>
            <button type="button" class="ghost sm" data-testid="matching-revert" disabled={busy.value} onClick={() => void revert(origin)}>
              Revert
            </button>
          </div>
        </div>
      ) : (
        <div class="row">
          <button type="button" class="primary sm" data-testid="matching-save" disabled={busy.value} onClick={() => void save(origin, tabId)}>
            {busy.value ? 'Testing steps…' : 'Save and test steps on this page'}
          </button>
        </div>
      )}
    </details>
  );
}
