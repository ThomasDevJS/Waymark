/**
 * Plays a built-in tutorial on the Practice page itself (D128), with the real player pieces: the
 * overlay UI (PlayerUI), the matcher (waitForMatch) and the advance rules (watchAdvance). It
 * stands in for the content script's controller and the service worker's run state, which an
 * extension page doesn't have; nothing here touches runs, frames or other tabs.
 */
import { PlayerUI } from '../../content/player/ui';
import { isOverlayPath, overlayHost, overlayRoot } from '../../content/overlay/host';
import { waitForMatch } from '../../core/matcher';
import { buildFingerprint } from '../../core/fingerprint/build';
import { watchAdvance } from '../../core/player/advance';
import { applyOp, startTutorial, tutorialView, type TutorialRun } from '../../core/tutorials/runner';
import { missingFingerprint, toStep, type Tutorial } from '../../core/tutorials/tutorials';

/** After an action, wait before the next step, as the player does (AFTER_ACTION_MS). */
const AFTER_ACTION_MS = 300;
/** A practice step that can't be found gives up sooner than the 8 s of a real page: nothing loads here. */
const PRACTICE_WAIT_MS = 2500;

export interface PracticeDeps {
  /** Asks the service worker to read a bundled step aloud (it honours mute and "Read each step aloud"). */
  speak(tutorialId: string, stepId: string, explicit: boolean): void;
  stopSpeech(): void;
  setMuted(muted: boolean): void;
  /**
   * Shows the practice view an element lives in, if it's on another one ("Go back" on the
   * off-track card). Returns false when no view holds it (the not-found demo).
   */
  reveal(guideId: string): boolean;
  /** True when the element exists in the app but its view isn't showing. */
  elsewhere(guideId: string): boolean;
  /** The run ended (Exit or Close on the done card). */
  onEnd(finished: boolean): void;
  /** A view changed, for the page's own status line and the test hook. */
  onView?(run: TutorialRun, phase: 'drawn' | 'not-found' | 'off-track' | 'done' | 'searching'): void;
}

export class PracticePlayer {
  private run: TutorialRun | null = null;
  private abort: AbortController | null = null;
  private stopAdvance: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The learner did the step; the next step is 300 ms away. The element may go meanwhile (a view change): not "lost". */
  private advancing = false;
  private offTrack = false;
  /** Each step is read once, when it is drawn or its card shows (not at every redraw). */
  private spokenRev = -1;
  /**
   * Keyboard users: on this page (ours, not a learner's app) focus follows the guide. After a
   * key press inside the tooltip, or Start in the list, the next step's main control gets focus.
   */
  private focusNext = false;
  private readonly ui: PlayerUI;

  constructor(private readonly deps: PracticeDeps) {
    this.ui = new PlayerUI({
      next: () => this.op('next'),
      back: () => this.op('back'),
      skip: () => this.op('skip'),
      exit: () => this.op('exit'),
      retry: () => this.op('retry'),
      report: () => this.ui.flash('On your own guides, this saves the step to Settings → Problems, so you can fix it.'),
      goBack: () => {
        const s = this.run?.tutorial.steps[this.run.stepIndex];
        this.offTrack = false; // appChanged must not draw a second time
        this.focusNext = this.overlayHasFocus();
        if (s?.target && deps.reveal(s.target)) requestAnimationFrame(() => this.draw());
      },
      mute: (muted) => {
        if (!this.run) return;
        this.run = { ...this.run, muted };
        deps.setMuted(muted);
        if (muted) deps.stopSpeech();
        this.ui.setMuted(muted);
      },
      replayVoice: () => this.speak(true),
      repeat: () => this.draw(true),
    });
  }

  get current(): TutorialRun | null {
    return this.run;
  }

  /** The app changed view: off the track, the learner may have come back on their own. */
  appChanged(): void {
    if (this.offTrack) requestAnimationFrame(() => this.draw());
  }

  /** Alt+. / Alt+, (the browser's shortcuts for guides) while this page has focus. */
  command(name: string): void {
    if (!this.run) return;
    if (name === 'next-step') {
      const s = this.run.tutorial.steps[this.run.stepIndex];
      // Like the player: a shortcut moves on from steps that have Next (notes, fields, Next steps).
      if (this.run.status === 'running' && s && (s.kind === 'note' || s.kind === 'input' || s.advance === 'next')) this.op('next');
    } else if (name === 'previous-step') this.op('back');
    else if (name === 'exit-guide') this.op('exit');
  }

  start(tutorial: Tutorial, muted: boolean): void {
    this.stop();
    this.run = startTutorial(tutorial, muted);
    this.focusNext = true; // the list's Start button is gone
    this.draw();
  }

  stop(): void {
    this.cleanup();
    this.ui.clear();
    if (this.run) this.deps.stopSpeech();
    this.run = null;
    this.spokenRev = -1;
  }

  private overlayHasFocus(): boolean {
    const host = overlayHost();
    return !!host && document.activeElement === host;
  }

  private op(o: Parameters<typeof applyOp>[1]): void {
    if (!this.run) return;
    const before = this.run;
    this.focusNext = this.overlayHasFocus();
    this.run = applyOp(before, o);
    if (this.run.status === 'exited') {
      const finished = before.status === 'finished';
      this.stop();
      this.deps.onEnd(finished);
      return;
    }
    if (this.run === before) return; // Back on step 1
    this.draw();
  }

  private cleanup(): void {
    this.abort?.abort();
    this.abort = null;
    this.stopAdvance?.();
    this.stopAdvance = null;
    clearTimeout(this.timer);
    this.advancing = false;
    this.offTrack = false;
  }

  private speak(explicit: boolean): void {
    const run = this.run;
    const s = run?.tutorial.steps[run.stepIndex];
    if (!run || !s || run.status !== 'running') return;
    if (!explicit && this.spokenRev === run.rev) return;
    this.spokenRev = run.rev;
    this.deps.speak(run.tutorial.id, s.id, explicit);
  }

  /** Gives focus to the drawn step's main control: Next, else the card's main button, else the target. */
  private moveFocus(target: Element | null): void {
    if (!this.focusNext) return;
    this.focusNext = false;
    const tip = overlayRoot().querySelector('.tip');
    const main = tip?.querySelector<HTMLElement>('[data-action="next"], button.primary');
    if (main) main.focus();
    else if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }

  private card(kind: 'done' | 'not-found' | 'off-track', run: TutorialRun): void {
    this.ui.showCard(kind, tutorialView(run));
    this.moveFocus(null);
    this.deps.onView?.(run, kind);
  }

  /** Draws the current step: finds its element with the real matcher, then spotlights it. */
  private draw(repeat = false): void {
    this.cleanup();
    // The previous step's tooltip goes at once: its buttons must not act on the next step.
    this.ui.clear();
    const run = this.run;
    if (!run) return;
    const view = tutorialView(run);
    if (run.status === 'finished') {
      this.deps.stopSpeech();
      this.card('done', run);
      return;
    }
    const s = run.tutorial.steps[run.stepIndex]!;
    if (!s.target) {
      this.ui.showStep(view, null);
      this.speak(repeat);
      this.moveFocus(null);
      this.deps.onView?.(run, 'drawn');
      return;
    }
    // On another view of the app: off track at once, as there is nothing to wait for.
    if (this.deps.elsewhere(s.target)) {
      this.card('off-track', run);
      this.offTrack = true;
      return;
    }
    const live = document.querySelector(`[data-guide-id="${CSS.escape(s.target)}"]`);
    const fp = live ? buildFingerprint(live) : missingFingerprint(s.target);
    const abort = new AbortController();
    this.abort = abort;
    this.deps.onView?.(run, 'searching');
    void waitForMatch(document, fp, { signal: abort.signal, timeoutMs: PRACTICE_WAIT_MS }).then((r) => {
      if (abort.signal.aborted || this.run?.rev !== run.rev) return;
      if (r.status !== 'found') {
        // The learner went to another view of the app meanwhile: the off-track card, as on a real site.
        if (this.deps.elsewhere(s.target!)) {
          this.card('off-track', run);
          this.offTrack = true;
          return;
        }
        this.card('not-found', run);
        return;
      }
      // Bring the element into view (on a narrow window the panel picture is below the app).
      const box = r.spotlight.getBoundingClientRect();
      if (repeat || box.top < 0 || box.bottom > innerHeight || box.left < 0 || box.right > innerWidth) r.spotlight.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      this.ui.showStep(view, r.spotlight, () => {
        if (!this.advancing) this.draw();
      });
      this.speak(repeat);
      this.moveFocus(s.kind === 'note' ? null : r.element);
      this.deps.onView?.(run, 'drawn');
      if (s.kind === 'note' || s.advance !== 'action') return;
      this.stopAdvance = watchAdvance({
        step: { ...toStep(s), target: fp },
        targets: r.tied,
        isOwnEvent: isOverlayPath,
        onAdvance: () => {
          const rev = run.rev;
          this.advancing = true;
          this.timer = setTimeout(() => {
            if (this.run?.rev === rev) this.op('next');
          }, AFTER_ACTION_MS);
        },
      });
    });
  }
}
