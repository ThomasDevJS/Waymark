/**
 * Built-in tutorials in the side panel (D128). Start opens the Practice page in a new tab (an
 * extension page: no permission). The section can be hidden; Help brings it back. Tutorials are
 * not guides: they aren't in the list, search, exports or badges.
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import { makePack } from '../../core/sharing/pack';
import { TUTORIALS, TUTORIALS_HIDDEN_KEY, tutorialAsGuide, type Tutorial } from '../../core/tutorials/tutorials';
import { Icon } from '../../ui/Icon';
import { originToMatchPattern } from '../../core/url/url';

/** null until read from storage. */
export const tutorialsHidden = signal<boolean | null>(null);
const moreOpen = signal<string | null>(null);
const message = signal<string | null>(null);
const error = signal<string | null>(null);

export function loadTutorialsHidden(): void {
  if (tutorialsHidden.value !== null) return;
  void chrome.storage.local.get(TUTORIALS_HIDDEN_KEY).then(
    (r) => (tutorialsHidden.value = !!r[TUTORIALS_HIDDEN_KEY]),
    () => (tutorialsHidden.value = false),
  );
}

export function setTutorialsHidden(hidden: boolean): void {
  tutorialsHidden.value = hidden;
  void chrome.storage.local.set({ [TUTORIALS_HIDDEN_KEY]: hidden });
  // The section (and its Hide button) is gone: focus goes to Help, which brings it back.
  requestAnimationFrame(() => document.querySelector<HTMLElement>(hidden ? '[data-testid="open-help"]' : '#tutorials-title')?.focus());
}

/** Opens the Practice page, playing a tutorial (the tour by default). An open practice tab is reused, so two never talk at once. */
export async function openPractice(id = 'tour'): Promise<void> {
  const url = chrome.runtime.getURL(`practice.html?tutorial=${encodeURIComponent(id)}`);
  try {
    const page = chrome.runtime.getURL('practice.html');
    const open = await chrome.runtime.getContexts?.({ contextTypes: [chrome.runtime.ContextType.TAB] });
    const tab = open?.find((c) => c.tabId >= 0 && (c.documentUrl === page || c.documentUrl?.startsWith(`${page}?`)));
    if (tab) {
      await chrome.tabs.update(tab.tabId, { url, active: true });
      if (tab.windowId >= 0) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  } catch {
    // getContexts missing or refused: open a new tab
  }
  await chrome.tabs.create({ url });
}

/** Tutorials copied in this panel: Copy says "Copied" instead of making another copy. */
const copied = signal<Set<string>>(new Set());

async function copyToGuides(t: Tutorial, tabUrl: string) {
  error.value = null;
  message.value = null;
  try {
    const guide = tutorialAsGuide(t, tabUrl);
    // Only onto a site the user allowed: the import must never ask for access (D128).
    if (!(await chrome.permissions.contains({ origins: [originToMatchPattern(guide.appOrigins[0]!)] }))) {
      error.value = 'Allow Waymark on this site first, then copy.';
      return;
    }
    const r = await send('pack.import', { text: JSON.stringify(makePack([guide])), choices: {} });
    moreOpen.value = null;
    if (r.imported) copied.value = new Set([...copied.value, t.id]);
    message.value = r.imported ? `Copied “${guide.title}” to your guides. It shows how a guide’s steps, notes and spoken text are written: edit it, or record your own steps.` : 'Nothing was copied.';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** `tabUrl`: the page of an allowed site, where "Copy to my guides" puts the copy; null hides it. */
export function Tutorials({ tabUrl }: { tabUrl: string | null }) {
  useEffect(loadTutorialsHidden, []);
  if (tutorialsHidden.value !== false) return null;
  return (
    <section class="card tutorials-card" aria-labelledby="tutorials-title" data-testid="tutorials">
      <div class="card-head">
        <div class="row nowrap">
          <h2 class="section-label" id="tutorials-title" tabIndex={-1}>
            <Icon name="tutorial" />
            Tutorials
          </h2>
          <span class="badge accent">Built-in</span>
        </div>
        <button type="button" class="ghost sm" data-testid="tutorials-hide" aria-describedby="tutorials-hide-hint" title="Help (?) brings them back" onClick={() => setTutorialsHidden(true)}>
          Hide
        </button>
      </div>
      <p class="hint" id="tutorials-hide-hint">Short guides that teach Waymark. They play on a tutorial page, never on your sites. If you hide them, Help (?) brings them back.</p>
      <ul class="guide-list">
        {TUTORIALS.map((t) => {
          const open = moreOpen.value === t.id;
          const moreId = `tutorial-more-${t.id}`;
          return (
            <li key={t.id} class={`guide-item lift${open ? ' open' : ''}`} data-testid={`tutorial-${t.id}`}>
              <div class="guide-row">
                <div class="guide-main">
                  <span class="tutorial-title">{t.title}</span>
                  <span class="guide-meta">
                    <span class="count">
                      {t.steps.length} steps · {t.minutes} min
                    </span>
                  </span>
                </div>
                <div class="guide-actions">
                  <button
                    type="button"
                    class="ghost icon sm"
                    data-testid={`tutorial-more-${t.id}`}
                    aria-label={`More actions for ${t.title}`}
                    title="More"
                    aria-expanded={open}
                    aria-controls={open ? moreId : undefined}
                    onClick={() => (moreOpen.value = open ? null : t.id)}
                  >
                    <Icon name="more" />
                  </button>
                  <button type="button" class="sm start" data-testid={`tutorial-start-${t.id}`} aria-label={`Start ${t.title} (opens the tutorial page)`} onClick={() => void openPractice(t.id)}>
                    <Icon name="play" />
                    Start
                  </button>
                </div>
              </div>
              {open && (
                <div class="guide-more unfold" id={moreId}>
                  <p class="small muted">{t.summary}</p>
                  <p class="small muted">Copy to my guides puts an editable draft on this site, made of note steps, to see how a guide is written.</p>
                  {tabUrl ? (
                    <div class="toolbar">
                      <button type="button" class="sm" data-testid={`tutorial-copy-${t.id}`} disabled={copied.value.has(t.id)} onClick={() => void copyToGuides(t, tabUrl)}>
                        {copied.value.has(t.id) ? (
                          <span class="swap" key="copied">
                            <Icon name="check" class="tick" />
                            Copied
                          </span>
                        ) : (
                          <>
                            <Icon name="duplicate" />
                            Copy to my guides
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <p class="small muted">To copy it into your guides as a starting point, open your web app and allow Waymark there.</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {/* Stays mounted, so the message is read when it appears. */}
      <p class="status-text ok" role="status" data-testid="tutorials-message">
        {message.value?.startsWith('Copied') && <Icon key={message.value} name="check" class="tick" />}
        {message.value ?? ''}
      </p>
      {error.value && (
        <p class="alert" role="alert">
          <Icon name="error" />
          {error.value}
        </p>
      )}
    </section>
  );
}
