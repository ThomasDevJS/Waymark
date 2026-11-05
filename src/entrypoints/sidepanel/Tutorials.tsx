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
  if (!hidden) requestAnimationFrame(() => document.getElementById('tutorials-title')?.focus());
}

/** Opens the Practice page, playing a tutorial (the tour by default). */
export function openPractice(id = 'tour'): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`practice.html?tutorial=${encodeURIComponent(id)}`) });
}

async function copyToGuides(t: Tutorial, tabUrl: string) {
  error.value = null;
  message.value = null;
  try {
    const guide = tutorialAsGuide(t, tabUrl);
    const r = await send('pack.import', { text: JSON.stringify(makePack([guide])), choices: {} });
    moreOpen.value = null;
    message.value = r.imported ? `Copied “${guide.title}” to your guides, as note steps. Open it with Edit and re-record the steps on your app.` : 'Nothing was copied.';
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
        <h2 class="section-label" id="tutorials-title" tabIndex={-1}>
          <Icon name="tutorial" />
          Tutorials <span class="badge accent">Built-in</span>
        </h2>
        <button type="button" class="ghost sm" data-testid="tutorials-hide" aria-describedby="tutorials-hide-hint" title="Help (?) brings them back" onClick={() => setTutorialsHidden(true)}>
          Hide
        </button>
      </div>
      <p class="hint" id="tutorials-hide-hint">Short guides that teach Waymark. They play on a practice page, never on your sites. If you hide them, Help (?) brings them back.</p>
      <ul class="guide-list">
        {TUTORIALS.map((t) => {
          const open = moreOpen.value === t.id;
          const moreId = `tutorial-more-${t.id}`;
          return (
            <li key={t.id} class={`guide-item${open ? ' open' : ''}`} data-testid={`tutorial-${t.id}`}>
              <div class="guide-row">
                <div class="guide-main">
                  <span class="guide-title">{t.title}</span>
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
                  <button type="button" class="sm start" data-testid={`tutorial-start-${t.id}`} aria-label={`Start ${t.title} (opens the practice page)`} onClick={() => openPractice(t.id)}>
                    <Icon name="play" />
                    Start
                  </button>
                </div>
              </div>
              {open && (
                <div class="guide-more" id={moreId}>
                  <p class="small muted">{t.summary}</p>
                  <p class="small muted">Copy to my guides makes an editable copy on your site, as note steps: a starting point for your own guide.</p>
                  {tabUrl ? (
                    <div class="toolbar">
                      <button type="button" class="sm" data-testid={`tutorial-copy-${t.id}`} onClick={() => void copyToGuides(t, tabUrl)}>
                        <Icon name="duplicate" />
                        Copy to my guides
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
      {message.value && (
        <p class="status-text ok" role="status" data-testid="tutorials-message">
          {message.value}
        </p>
      )}
      {error.value && (
        <p class="alert" role="alert">
          <Icon name="error" />
          {error.value}
        </p>
      )}
    </section>
  );
}
