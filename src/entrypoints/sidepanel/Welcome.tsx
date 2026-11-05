/**
 * First-run welcome (D92, D121): one short card with the three things to know (turn Waymark on
 * for a site, record, play), all visible at once, and one button to get started. It shows until
 * dismissed; the flag lives in storage.local. Help (the "?" in the header) brings it back.
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';

export const WELCOME_KEY = 'ui:welcomeDone';

export const WELCOME_STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'shield', title: 'Allow', text: 'Open the web app you want to teach and press “Allow on this site”. Waymark runs only on the sites you allow.' },
  { icon: 'circle', title: 'Record', text: 'Name your guide, press Record and do the task once. Each click becomes a step. What you type is never saved.' },
  { icon: 'play', title: 'Play', text: 'Press Start on a guide. Waymark highlights each step on the page, explains it and can read it aloud.' },
];

/** null until the flag is read, so the panel doesn't jump when the welcome appears. */
export const welcomeShown = signal<boolean | null>(null);

export function loadWelcome(): void {
  if (welcomeShown.value !== null) return;
  void chrome.storage.local.get(WELCOME_KEY).then(
    (r) => (welcomeShown.value = !r[WELCOME_KEY]),
    () => (welcomeShown.value = false),
  );
}

/** Help → "Show the welcome again". */
export function showWelcome(): void {
  welcomeShown.value = true;
  requestAnimationFrame(() => document.getElementById('welcome-title')?.focus());
}

function finish() {
  welcomeShown.value = false;
  void chrome.storage.local.set({ [WELCOME_KEY]: true });
  // The welcome is gone: put focus on the panel's next useful control, not on <body>.
  // In this order: the guide name field, Allow, the site card, the header.
  const order = ['[data-testid="guide-title"]', '[data-testid="allow-site"]', '.site-card button', '.app-header button'];
  requestAnimationFrame(() => (order.map((q) => document.querySelector<HTMLElement>(q)).find(Boolean) ?? document.body).focus());
}

/** `extra` is an optional second action (the tutorials: "Try a tutorial"). */
export function Welcome({ extra }: { extra?: ComponentChildren }) {
  useEffect(loadWelcome, []);
  if (!welcomeShown.value) return null;
  return (
    <section class="card welcome" aria-labelledby="welcome-title" data-testid="welcome">
      <div class="card-head">
        <h2 id="welcome-title" tabIndex={-1}>
          Welcome to Waymark
        </h2>
      </div>
      <p class="small muted">Waymark shows people how to use a web app, step by step, on the real page. It takes three steps:</p>
      <ol class="welcome-list">
        {WELCOME_STEPS.map((s, n) => (
          <li key={s.title}>
            <span class="welcome-icon" aria-hidden="true">
              <Icon name={s.icon} size={18} />
            </span>
            <div>
              <h3>
                {n + 1}. {s.title}
              </h3>
              <p class="small">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div class="row">
        <button type="button" class="primary" data-testid="welcome-done" onClick={finish}>
          Get started
        </button>
        {extra}
      </div>
    </section>
  );
}
