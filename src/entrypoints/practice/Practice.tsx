/**
 * The Practice page (D128): a small pretend invoicing app inside the extension, where built-in
 * tutorials play with the real player. It's an extension page, so it needs no site access and
 * no content script, and nothing typed here leaves it. The panel picture on the right gives the
 * tutorials something to point at when they explain the side panel.
 */
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import { TUTORIALS, tutorialById, type Tutorial } from '../../core/tutorials/tutorials';
import { Icon } from '../../ui/Icon';
import { HdOffer } from '../../ui/HdOffer';
import { Mark } from '../../ui/Mark';
import { PracticePlayer } from './player';

type View = 'dashboard' | 'invoices' | 'new';
const view = signal<View>('dashboard');
const playing = signal<Tutorial | null>(null);
const sent = signal<string | null>(null);
const ended = signal<string | null>(null);
/** The drawn step's revision: the HD voice offer's sample stops when it changes (D141). */
const stepRev = signal<number | null>(null);

/** Test builds mark the player's state on <html>, as the content script does (data-waymark-test-*). */
function mark(state: string | null) {
  if (!__WAYMARK_TEST__) return;
  if (state === null) delete document.documentElement.dataset.waymarkTestPractice;
  else document.documentElement.dataset.waymarkTestPractice = state;
}

/** Which practice view holds each element, for "Go back" on the off-track card. */
export const VIEW_OF: Record<string, View> = {
  'practice-new-invoice': 'dashboard',
  'practice-overdue': 'dashboard',
  'practice-chart': 'dashboard',
  'practice-form': 'new',
  'practice-customer': 'new',
  'practice-terms': 'new',
  'practice-copy': 'new',
  'practice-send': 'new',
};

const player = new PracticePlayer({
  reveal: (id) => {
    const v = VIEW_OF[id];
    if (v) view.value = v;
    return !!v;
  },
  elsewhere: (id) => !!VIEW_OF[id] && VIEW_OF[id] !== view.value,
  speak: (tutorialId, stepId, explicit) => void send('tutorial.speak', { tutorialId, stepId, explicit }).catch(() => undefined),
  stopSpeech: () => void send('tutorial.stop', {}).catch(() => undefined),
  setMuted: (muted) => void send('voice.settings.set', { patch: { muted } }).catch(() => undefined),
  onEnd: (finished) => {
    const t = playing.value;
    playing.value = null;
    ended.value = t ? (finished ? `You finished “${t.title}”.` : `You left “${t.title}”.`) : null;
    mark(finished ? 'finished' : 'exited');
    history.replaceState(null, '', location.pathname);
    requestAnimationFrame(() => document.getElementById('tutorials-title')?.focus());
  },
  onView: (run, phase) => {
    mark(`${phase}:${run.stepIndex}`);
    if (phase !== 'searching') stepRev.value = run.rev;
  },
});

/** Stop the tutorial in the list: the same ending as Exit in the tooltip. */
function stopPlaying() {
  const t = playing.value;
  player.stop();
  playing.value = null;
  ended.value = t ? `You left “${t.title}”.` : null;
  mark('exited');
  history.replaceState(null, '', location.pathname);
  requestAnimationFrame(() => document.getElementById('tutorials-title')?.focus());
}

export async function startTutorial(t: Tutorial): Promise<void> {
  // Every tutorial starts on the dashboard with an empty form.
  view.value = 'dashboard';
  sent.value = null;
  ended.value = null;
  document.querySelector<HTMLFormElement>('[data-guide-id="practice-form"]')?.reset();
  playing.value = t;
  history.replaceState(null, '', `${location.pathname}?tutorial=${t.id}`);
  const muted = await send('voice.settings.get', {}).then(
    (s) => s.muted,
    () => false,
  );
  // Stopped, or another tutorial started, while the setting was read: don't start this one.
  if (playing.value !== t) return;
  requestAnimationFrame(() => {
    if (playing.value === t) player.start(t, muted);
  });
}

function Chart() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const draw = () => {
      const bars = [5, 3, 6, 4, 7, 5, 8, 6, 9, 7, 8, 10];
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = getComputedStyle(c).color || '#2f5bd3';
      const w = c.width / bars.length;
      bars.forEach((b, i) => ctx.fillRect(i * w + 4, c.height - b * 10, w - 8, b * 10));
    };
    draw();
    // Redrawn when the theme changes while the page is open.
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => requestAnimationFrame(draw);
    mq.addEventListener('change', onScheme);
    return () => mq.removeEventListener('change', onScheme);
  }, []);
  return <canvas ref={ref} class="chart" width={360} height={110} data-guide-id="practice-chart" role="img" aria-label="Revenue chart for this year (practice data)" />;
}

function Dashboard() {
  return (
    <section class="card stack fade-in" aria-labelledby="dash-title">
      <h2 id="dash-title">Dashboard</h2>
      <div class="row">
        <button type="button" class="primary" data-guide-id="practice-new-invoice" onClick={() => (view.value = 'new')}>
          <Icon name="plus" />
          New invoice
        </button>
        <button type="button" onClick={() => (view.value = 'invoices')}>
          View all invoices
        </button>
      </div>
      <p class="overdue" data-guide-id="practice-overdue">
        You have 3 overdue invoices this month.
      </p>
      <h3 class="small">Revenue</h3>
      <Chart />
    </section>
  );
}

const INVOICES = [
  ['INV-1042', 'Ada’s Bakery', '€ 120.00', 'Paid'],
  ['INV-1043', 'Lovelace & Co', '€ 860.50', 'Overdue'],
  ['INV-1044', 'Babbage Tools', '€ 42.00', 'Draft'],
] as const;

function Invoices() {
  return (
    <section class="card stack fade-in" aria-labelledby="inv-title">
      <h2 id="inv-title">Invoices</h2>
      {sent.value && (
        <p class="banner success" role="status">
          <Icon name="check" class="tick" />
          {sent.value}
        </p>
      )}
      <table class="invoices">
        <thead>
          <tr>
            <th scope="col">Number</th>
            <th scope="col">Customer</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {INVOICES.map((r) => (
            <tr key={r[0]}>
              {r.map((c, i) => (
                <td key={i}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function NewInvoice() {
  return (
    <section class="card stack fade-in" aria-labelledby="new-title">
      <h2 id="new-title">New invoice</h2>
      <form
        class="stack"
        data-guide-id="practice-form"
        // Enter in a text field would send the form (implicit submission, which even names the Send
        // button as its submitter). A learner finishing a field with Enter stays on the form; the
        // player still sees the key, so a typing step moves on (D60).
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as Element).localName === 'input' && (e.target as HTMLInputElement).type !== 'checkbox') e.preventDefault();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          sent.value = 'Invoice sent (practice only: nothing was sent).';
          view.value = 'invoices';
        }}
      >
        <label class="field">
          <span class="label">Customer name</span>
          {/* Practice field: never stored. autocomplete off so the browser doesn't offer real names. */}
          <input data-guide-id="practice-customer" name="customer" autocomplete="off" />
        </label>
        <label class="field">
          <span class="label">Amount</span>
          <input name="amount" inputMode="decimal" autocomplete="off" placeholder="0.00" />
        </label>
        <label class="field">
          <span class="label">Payment terms</span>
          <select data-guide-id="practice-terms" name="terms">
            <option value="">Choose…</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
          </select>
        </label>
        <label class="check">
          <input type="checkbox" data-guide-id="practice-copy" name="copy" />
          <span>Send me a copy</span>
        </label>
        <div class="row">
          <button type="submit" class="primary" data-guide-id="practice-send">
            Send invoice
          </button>
          <button type="button" class="ghost" onClick={() => (view.value = 'dashboard')}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

/** A picture of the side panel, for the tutorials that explain it. Not interactive. */
function PanelPicture() {
  return (
    <figure class="panel-pic" data-guide-id="pic-panel" aria-labelledby="pic-caption">
      <figcaption id="pic-caption" class="small">
        <strong>Picture of the Waymark side panel.</strong>{' '}
        <span class="muted">For reading only: nothing here can be clicked. The real panel opens when you click the Waymark icon in the browser’s toolbar.</span>
      </figcaption>
      <div class="pic" aria-hidden="true">
        <div class="pic-head">
          <Mark /> Waymark
        </div>
        <div class="pic-card">
          <strong class="small">Record a guide</strong>
          <div class="pic-row">
            <span class="pic-input">Create an invoice</span>
            <span class="pic-btn primary" data-guide-id="pic-record">
              ● Record
            </span>
          </div>
        </div>
        <div class="pic-card">
          <span class="pic-badge rec">● Recording</span>
          <div class="pic-row">
            <span class="pic-btn">Pause</span>
            <span class="pic-btn">Undo</span>
            <span class="pic-btn primary" data-guide-id="pic-stop">
              ■ Stop
            </span>
          </div>
        </div>
        <div class="pic-card" data-guide-id="pic-step">
          <div class="pic-row">
            <span class="pic-num">2</span>
            <span class="small" data-guide-id="pic-step-title">
              Click <strong>New invoice</strong>
            </span>
          </div>
          <div class="pic-row">
            <span class="pic-btn" data-guide-id="pic-test">
              Test step · Re-pick element
            </span>
            <span class="pic-btn ghost" data-guide-id="pic-more">
              More options ▾
            </span>
          </div>
          <div class="pic-row">
            <span class="pic-btn primary" data-guide-id="pic-save">
              Save
            </span>
            <span class="pic-btn ghost">Discard and close</span>
          </div>
        </div>
        <div class="pic-card">
          <div class="pic-row">
            <span class="small grow">Create an invoice</span>
            <span class="pic-btn ghost">Edit</span>
            <span class="pic-btn ghost" data-guide-id="pic-guide-more">
              ⋯
            </span>
            <span class="pic-btn">▶ Start</span>
          </div>
          <div class="pic-row">
            <span class="pic-btn">Export…</span>
            <span class="pic-btn" data-guide-id="pic-import">
              Import…
            </span>
          </div>
        </div>
      </div>
    </figure>
  );
}

function TutorialList() {
  const t = playing.value;
  return (
    <section class="card stack tutorials" aria-labelledby="tutorials-title" data-testid="practice-tutorials">
      <div class="card-head">
        <h2 id="tutorials-title" tabIndex={-1}>
          <Icon name="tutorial" /> Tutorials
        </h2>
        <span class="badge accent">Built-in</span>
      </div>
      <p class="small" role="status" data-testid="practice-status">
        {t ? `Playing “${t.title}”. Follow the box on the page.` : (ended.value ?? '')}
      </p>
      {t ? (
        <div>
          <button type="button" class="sm" data-testid="practice-stop" onClick={stopPlaying}>
            <Icon name="stop" />
            Stop the tutorial
          </button>
        </div>
      ) : (
        <>
          <ol class="tutorial-list">
            {TUTORIALS.map((x) => (
              <li key={x.id}>
                <div class="grow">
                  <strong>{x.title}</strong>
                  <span class="small muted block">
                    {x.summary} · {x.minutes} min
                  </span>
                </div>
                <button type="button" class="sm" data-testid={`practice-start-${x.id}`} aria-label={`Start ${x.title}`} onClick={() => void startTutorial(x)}>
                  <Icon name="play" />
                  Start
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export function Practice() {
  useEffect(() => {
    const t = tutorialById(new URLSearchParams(location.search).get('tutorial'));
    if (t) void startTutorial(t);
    else mark('ready');
    // The browser's guide shortcuts (Alt+. / Alt+,) also reach extension pages; only the focused one acts.
    const onCommand = (name: string) => {
      if (document.hasFocus()) player.command(name);
    };
    chrome.commands?.onCommand.addListener(onCommand);
    // Closing the tab mid-step stops the tutorial's voice.
    const onHide = () => player.stop();
    addEventListener('pagehide', onHide);
    return () => {
      chrome.commands?.onCommand.removeListener(onCommand);
      removeEventListener('pagehide', onHide);
      player.stop();
    };
  }, []);
  const v = view.value;
  useEffect(() => player.appChanged(), [v]);
  const nav = (id: View, label: string) => (
    <button type="button" class={`nav-link${v === id ? ' on' : ''}`} aria-current={v === id ? 'page' : undefined} data-guide-id={`practice-nav-${id}`} onClick={() => (view.value = id)}>
      {label}
    </button>
  );
  return (
    <>
      <header class="practice-header">
        <h1 class="app-name">
          <span class="logo" aria-hidden="true">
            N
          </span>
          Northwind Invoices
          <span class="badge warn">Practice</span>
        </h1>
        <nav aria-label="Practice app">
          {nav('dashboard', 'Dashboard')}
          {nav('invoices', 'Invoices')}
          {nav('new', 'New invoice')}
        </nav>
      </header>
      <div class="practice-layout">
        <main class="stack">
          <p class="practice-note small">
            <Icon name="info" />
            <span>This is a practice page inside Waymark. Nothing here is real, nothing you type is kept, and it never goes online.</span>
          </p>
          {v === 'dashboard' && <Dashboard />}
          {v === 'invoices' && <Invoices />}
          {/* The form stays in the page (hidden), so a tutorial's reset finds it. */}
          <div hidden={v !== 'new'}>
            <NewInvoice />
          </div>
        </main>
        <aside class="stack">
          <TutorialList />
          {/* The first time a tutorial is about to speak: offer the HD voice once (D140). */}
          {playing.value && (
            <HdOffer
              about="tutorials"
              contentLang="en"
              stepKey={stepRev.value}
              stopSpeech={() => send('tutorial.stop', {})}
              onClosed={() => document.querySelector<HTMLElement>('[data-testid="practice-stop"]')?.focus()}
            />
          )}
          <PanelPicture />
        </aside>
      </div>
    </>
  );
}
