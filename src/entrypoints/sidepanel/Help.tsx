/**
 * Help in the side panel (D122): the header's "?" opens a short Help card, and small "?" buttons
 * next to a concept expand one plain sentence in place (a disclosure, never a hover tooltip, so
 * keyboard and touch users can reach it).
 */
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import { Icon } from '../../ui/Icon';
import { FLAG_HELP } from './steps';
import { showWelcome } from './Welcome';

export const helpOpen = signal(false);

/** Opens a section of the Settings page (options.html#id) in a tab. */
export function openSettings(section?: string): void {
  if (!section) {
    void chrome.runtime.openOptionsPage();
    return;
  }
  void chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#${section}`) });
}

/** Every warning a learner or author can see, in one place (the same words as docs/TESTING.md section 3). */
export const WARNINGS: { label: string; where: string; help: string }[] = [
  { label: FLAG_HELP['low-confidence'].label, where: 'On a recorded step', help: FLAG_HELP['low-confidence'].help },
  { label: FLAG_HELP.canvas.label, where: 'On a recorded step', help: FLAG_HELP.canvas.help },
  { label: FLAG_HELP['closed-shadow'].label, where: 'On a recorded step', help: FLAG_HELP['closed-shadow'].help },
  { label: 'Not recorded', where: 'On the REC bar', help: 'That click had nothing Waymark could find again later, so no step was added. Click the real button, link or field, or add a note.' },
  { label: 'Found, but it may break', where: 'After Test step', help: 'Waymark found it with only one strong clue. Re-pick the element to make it sturdier.' },
  { label: 'Can’t find this step', where: 'While a guide plays', help: 'The element wasn’t on the page within 8 seconds. Waymark never guesses. Retry, Skip, or Report the broken step.' },
];

/** A small "?" button that shows one explanation next to it. */
export function HelpTip({ label, children, testid }: { label: string; children?: ComponentChildren; testid?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span class="help-tip">
      <button
        type="button"
        class="ghost icon xs help-button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-testid={testid}
        onClick={() => setOpen(!open)}
      >
        <Icon name="help" />
      </button>
      {open && (
        <span class="help-text small unfold" id={id} data-testid={testid ? `${testid}-text` : undefined}>
          {children}
        </span>
      )}
    </span>
  );
}

/** The header's Help card. `extra` holds PR 2's tutorials link. */
export function HelpCard({ extra }: { extra?: ComponentChildren }) {
  if (!helpOpen.value) return null;
  return (
    <section
      class="card help-card unfold"
      id="help"
      aria-labelledby="help-title"
      data-testid="help"
      onKeyDown={(e) => {
        if (e.key === 'Escape') closeHelp();
      }}
    >
      <div class="card-head">
        <h2 id="help-title" tabIndex={-1}>
          Help
        </h2>
        <button type="button" class="ghost icon sm" aria-label="Close help" title="Close help" data-testid="help-close" onClick={() => closeHelp()}>
          <Icon name="close" />
        </button>
      </div>
      <ul class="list help-links">
        {extra}
        <li>
          <button
            type="button"
            class="ghost help-link"
            data-testid="help-welcome"
            onClick={() => {
              helpOpen.value = false;
              showWelcome();
            }}
          >
            <Icon name="info" />
            <span class="grow">Show the welcome again</span>
          </button>
        </li>
        <li>
          <button type="button" class="ghost help-link" data-testid="help-shortcuts" onClick={() => openSettings('about')}>
            <Icon name="settings" />
            <span class="grow">Keyboard shortcuts</span>
            <span class="visually-hidden"> (opens Settings in a new tab)</span>
          </button>
        </li>
        <li>
          <button type="button" class="ghost help-link" data-testid="help-problems" onClick={() => openSettings('problems')}>
            <Icon name="flag" />
            <span class="grow">Something isn’t working</span>
            <span class="visually-hidden"> (opens Settings in a new tab)</span>
          </button>
        </li>
      </ul>
      <details class="warnings-help" data-testid="help-warnings">
        <summary>What the warnings mean</summary>
        <dl>
          {WARNINGS.map((w) => (
            <div key={w.label}>
              <dt>
                <span class="badge warn">
                  <Icon name="warn" />
                  {w.label}
                </span>{' '}
                <span class="small muted">{w.where}</span>
              </dt>
              <dd class="small">{w.help}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

export function toggleHelp(): void {
  helpOpen.value = !helpOpen.value;
  if (helpOpen.value) requestAnimationFrame(() => document.getElementById('help-title')?.focus());
}

function closeHelp(): void {
  helpOpen.value = false;
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="open-help"]')?.focus());
}
