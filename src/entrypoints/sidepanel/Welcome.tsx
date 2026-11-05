/**
 * First-run welcome (D92): three short cards that explain Allow, Record and Play. Shown once in
 * the side panel until the user finishes or skips it; the flag lives in storage.local.
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';

export const WELCOME_KEY = 'ui:welcomeDone';

export const WELCOME_STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'shield', title: 'Allow', text: 'Open the web app you want to teach and press “Allow on this site”. Waymark only runs on the sites you allow.' },
  { icon: 'circle', title: 'Record', text: 'Name your guide, press Record and do the task once. Each click becomes a step. What you type is never saved.' },
  { icon: 'play', title: 'Play', text: 'Press Start on a guide. Waymark highlights each step on the page, explains it and reads it aloud.' },
];

/** null until the flag is read, so the panel doesn't jump when the welcome appears. */
export const welcomeShown = signal<boolean | null>(null);
const index = signal(0);

export function loadWelcome(): void {
  void chrome.storage.local.get(WELCOME_KEY).then(
    (r) => (welcomeShown.value = !r[WELCOME_KEY]),
    () => (welcomeShown.value = false),
  );
}

function finish() {
  welcomeShown.value = false;
  void chrome.storage.local.set({ [WELCOME_KEY]: true });
  // The welcome is gone: put focus on the panel's next useful control, not on <body>.
  requestAnimationFrame(() => (document.querySelector<HTMLElement>('.site-card button, [data-testid="guide-title"], .app-header button') ?? document.body).focus());
}

export function Welcome() {
  useEffect(loadWelcome, []);
  if (!welcomeShown.value) return null;
  const i = index.value;
  const step = WELCOME_STEPS[i]!;
  const last = i === WELCOME_STEPS.length - 1;
  return (
    <section class="card welcome" aria-labelledby="welcome-title" data-testid="welcome">
      <div class="card-head">
        <h2 id="welcome-title">Welcome to Waymark</h2>
        <button type="button" class="ghost sm" data-testid="welcome-skip" onClick={finish}>
          Skip
        </button>
      </div>
      <p class="small muted">Waymark shows people how to use a web app, step by step, on the real page.</p>
      <ol class="welcome-steps" aria-label="How it works">
        {WELCOME_STEPS.map((s, n) => (
          <li key={s.title} class={n === i ? 'current' : n < i ? 'done' : ''}>
            <button type="button" class="ghost sm" aria-current={n === i ? 'step' : undefined} onClick={() => (index.value = n)}>
              <span class="num">{n + 1}</span>
              <span class="visually-hidden">. </span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>
      <div class="welcome-body" aria-live="polite">
        <span class="welcome-icon" aria-hidden="true">
          <Icon name={step.icon} size={20} />
        </span>
        <div>
          <h3>
            {i + 1}. {step.title}
          </h3>
          <p class="small">{step.text}</p>
        </div>
      </div>
      <div class="row">
        <button type="button" class="ghost" disabled={i === 0} onClick={() => (index.value = i - 1)}>
          Back
        </button>
        <button type="button" class="primary push" data-testid="welcome-next" onClick={() => (last ? finish() : (index.value = i + 1))}>
          {last ? 'Get started' : 'Next'}
          {!last && <Icon name="chevron-right" />}
        </button>
      </div>
    </section>
  );
}
