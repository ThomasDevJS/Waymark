/**
 * Content side of a run (SPEC: Player). Every granted frame runs the matcher for the current
 * step and reports its best score; the service worker names one winning frame, which draws the
 * spotlight and tooltip. The top frame draws note steps and the not-found, off-track and done
 * cards. All learner actions go back to the service worker, which owns the run.
 */
import { send } from '../../core/messaging/client';
import type { ContentPush } from '../../core/messaging/protocol';
import { waitForMatch, type MatchResult } from '../../core/matcher';
import { isVisible } from '../../core/fingerprint/dom';
import { watchAdvance } from '../../core/player/advance';
import type { RunOp, RunView } from '../../core/player/run';
import { urlMatches } from '../../core/url/url';
import { isOverlayPath, onOverlayReleased } from '../overlay/host';
import { testMark, testSpot } from '../test-hooks';
import { bestSpeechVoice } from '../../core/voice/voice';
import { PlayerUI } from './ui';

/** After any action, wait 300 ms before searching for the next target (SPEC: Advancing). */
export const AFTER_ACTION_MS = 300;
/** Off track: the page does not match the step's URL rule and the target is missing for 3 s. */
export const OFF_TRACK_MS = 3000;

export interface PlayerDeps {
  frameToken: string;
  framePath: () => string[];
}

/**
 * Fallback where chrome.tts is missing (SPEC: Voiceover): the top frame speaks with
 * speechSynthesis. The text is the step's stored voice text, sent by the service worker.
 */
function speakFallback(p: { text: string; lang: string; rate: number }, retried = false): void {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  synth.cancel();
  // The voice list often loads asynchronously: wait for it once.
  if (!synth.getVoices().length && !retried) {
    synth.addEventListener('voiceschanged', () => speakFallback(p, true), { once: true });
    return;
  }
  const u = new SpeechSynthesisUtterance(p.text.slice(0, 5000));
  u.lang = p.lang;
  u.rate = p.rate;
  // The best on-device voice (remote ones send text to a server). Settings never reach content
  // scripts, so the user's own voice choice does not apply here.
  const local = bestSpeechVoice(synth.getVoices(), p.lang, navigator.language);
  if (!local) return;
  u.voice = local;
  synth.speak(u);
}

export function startPlayerClient(deps: PlayerDeps): { apply(view: RunView): void; onRoute(url: string): void; dispose(): void } {
  const isTop = window === window.top;
  let view: RunView | null = null;
  let stepToken: string | null = null;
  let abort: AbortController | null = null;
  let result: MatchResult | null = null;
  let searchDone = false;
  let stopAdvance: (() => void) | null = null;
  let drawnFor: string | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  const op = (o: RunOp) => {
    if (!view?.step) {
      if (o === 'exit') send('run.advance', { stepId: '', op: 'exit' }).catch(() => undefined);
      return;
    }
    send('run.advance', { stepId: view.step.id, op: o }).catch(() => undefined);
  };

  const ui = new PlayerUI({
    next: () => op('next'),
    back: () => op('back'),
    skip: () => op('skip'),
    exit: () => op('exit'),
    retry: () => {
      if (view) startSearch(view);
    },
    report: () => {
      if (!view?.step) return;
      send('run.problem', { stepId: view.step.id })
        .then(() => ui.flash('Thanks. The broken step was saved to the Problems list.'))
        .catch(() => undefined);
    },
    goBack: () => history.back(),
    mute: (muted) => {
      send('run.mute', { muted }).catch(() => undefined);
    },
    replayVoice: () => {
      if (view?.step) send('run.replay', { stepId: view.step.id }).catch(() => undefined);
    },
    // Repeat step: search again (the page may have changed or been scrolled), redraw the
    // spotlight with its pulse, scroll the element into view and read the step again (D106).
    repeat: () => {
      const v = view;
      if (!v?.step || v.status !== 'running') return;
      testMark('repeat', String(Number(document.documentElement.getAttribute('data-waymark-test-repeat') ?? 0) + 1));
      startSearch(v);
      send('run.replay', { stepId: v.step.id }).catch(() => undefined);
    },
  });

  const clearStep = () => {
    abort?.abort();
    abort = null;
    stopAdvance?.();
    stopAdvance = null;
    timers.forEach(clearTimeout);
    timers.clear();
    ui.clear();
    drawnFor = null;
    result = null;
    searchDone = false;
    testSpot(null);
    testMark('player', 'idle');
  };

  const onStartPageUrl = (v: RunView) => !!v.step && urlMatches(v.step.url, topUrl(), v.appOrigins);

  function topUrl(): string {
    try {
      return window.top?.location.href ?? location.href;
    } catch {
      return location.href; // cross-origin top: only the top frame checks URLs
    }
  }

  const report = (v: RunView, r: MatchResult) => {
    const fp = v.step?.target;
    send('run.match', {
      stepToken: v.stepToken ?? '',
      frameToken: deps.frameToken,
      found: r.status === 'found',
      score: r.status === 'found' ? r.score : r.bestScore,
      margin: r.status === 'found' ? r.margin : 0,
      instance: fp?.instance ?? 'unique',
      pathMatches: !!fp && JSON.stringify(deps.framePath()) === JSON.stringify(fp.framePath),
    }).catch(() => undefined);
  };

  function startSearch(v: RunView) {
    const step = v.step;
    if (!step) return;
    abort?.abort();
    stopAdvance?.(); // the previous match's elements no longer count while searching again
    stopAdvance = null;
    ui.clear();
    testSpot(null);
    drawnFor = null;
    searchDone = false;
    result = null;
    if (!step.target) {
      // note and navigate steps have no element; the top frame shows a centered tooltip
      if (isTop) {
        // Back onto a navigate step whose page we are already on must not bounce forward again.
        if (step.kind === 'navigate' && v.cause !== 'back' && onStartPageUrl(v)) return op('done');
        ui.showStep(v, null);
        drawnFor = v.stepToken;
        testMark('player', `note:${v.stepIndex}`);
      }
      return;
    }
    const ac = new AbortController();
    abort = ac;
    testMark('player', `searching:${v.stepIndex}`);
    if (isTop) {
      later(() => {
        if (view?.stepToken === v.stepToken && !view.winner && !onStartPageUrl(view)) {
          ui.showCard('off-track', view);
          testMark('player', `off-track:${v.stepIndex}`);
        }
      }, OFF_TRACK_MS);
    }
    void waitForMatch(document, step.target, { signal: ac.signal }).then((r) => {
      if (ac.signal.aborted || view?.stepToken !== v.stepToken) return;
      result = r;
      searchDone = true;
      report(v, r);
      render();
    });
  }

  /** Draws or hides this frame's part of the current step, given the latest view. */
  function render() {
    const v = view;
    if (!v?.step || !v.stepToken) return;
    // The service worker has no winner but this frame finished its search: its report may have
    // been dropped (the board is cleared when a new page loads, possibly after the report
    // arrived). Send it again; the board only broadcasts on a change, so this cannot loop (D45).
    if (!v.winner && searchDone && result && v.step.target) report(v, result);
    const mine = v.winner === deps.frameToken && result?.status === 'found';
    if (mine && drawnFor !== v.stepToken && result?.status === 'found') {
      const r = result;
      // Draw on the box the learner can see (a visually hidden control is shown through its
      // label, R7); for repeated elements the matcher picks the first visible tied candidate.
      const target = r.spotlight ?? r.tied.find((e) => isVisible(e)) ?? r.element;
      const rect = target.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
      ui.showStep(v, target, () => {
        // target removed or re-rendered: match again on the same step
        if (view?.stepToken === v.stepToken) startSearch(view);
      });
      drawnFor = v.stepToken;
      stopAdvance?.();
      // A click on the spotlighted box (e.g. the label of a hidden checkbox) also counts.
      const targets = r.tied.includes(target) ? r.tied : [...r.tied, target];
      stopAdvance = watchAdvance({ step: v.step, targets, isOwnEvent: isOverlayPath, onAdvance: () => op('done') });
      testSpot(target, v.stepIndex);
      testMark('player', `drawn:${v.stepIndex}`);
      return;
    }
    // Another frame found the target: the top frame's off-track or not-found card goes away.
    if (!mine && v.winner && (ui.card === 'off-track' || ui.card === 'not-found')) {
      ui.clear();
      testMark('player', `elsewhere:${v.stepIndex}`);
    }
    if (!mine && drawnFor === v.stepToken && v.step.target) {
      ui.clear();
      stopAdvance?.();
      stopAdvance = null;
      drawnFor = null;
      testSpot(null);
    }
    // The top frame shows "not found" when its own search gave up and no frame found the target.
    if (isTop && searchDone && result?.status === 'not-found' && !v.winner && onStartPageUrl(v)) {
      ui.showCard('not-found', v);
      testMark('player', `not-found:${v.stepIndex}`);
    }
  }

  const apply = (next: RunView) => {
    // Views can arrive out of order (a reply to a page-load report vs. a push): keep the newest.
    if (view && next.runId && view.runId === next.runId && next.rev < view.rev) return;
    view = next;
    ui.setMuted(next.muted);
    if (!next.active || next.status === 'none' || next.status === 'paused') {
      clearStep();
      stepToken = null;
      testMark('player', next.status === 'paused' ? 'paused' : 'off');
      return;
    }
    if (next.status === 'finished') {
      clearStep();
      stepToken = next.stepToken;
      if (isTop) {
        ui.showCard('done', next);
        testMark('player', 'done');
      }
      return;
    }
    if (next.stepToken !== stepToken) {
      clearStep();
      stepToken = next.stepToken;
      const v = next;
      later(() => {
        if (view?.stepToken === v.stepToken) startSearch(view);
      }, next.cause === 'action' ? AFTER_ACTION_MS : 0);
      return;
    }
    render();
  };

  const onMessage = (msg: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    const m = msg as ContentPush;
    if (m?.type === 'run.changed' && m.payload && typeof m.payload.active === 'boolean') apply(m.payload);
    else if (m?.type === 'tts.content' && isTop) speakFallback(m.payload);
    else if (m?.type === 'tts.stop' && isTop) window.speechSynthesis?.cancel();
  };
  chrome.runtime.onMessage.addListener(onMessage);

  // A Test step highlight took the overlay for a moment: draw the current step again.
  const offReleased = onOverlayReleased(ui, () => {
    const v = view;
    if (!v?.step || v.status !== 'running' || ui.drawn) return;
    drawnFor = null;
    if (!v.step.target) {
      if (isTop) {
        ui.showStep(v, null);
        drawnFor = v.stepToken;
      }
    } else render();
  });

  return {
    apply,
    /** Navigate steps advance when the URL matches the step's URL rule. */
    onRoute(url: string) {
      const v = view;
      if (!v?.step || v.status !== 'running') return;
      // A route change re-runs a search that already gave up (SPEC: playback step 6); a search
      // still running listens to route changes itself.
      if (v.step.target && searchDone && drawnFor !== v.stepToken) {
        startSearch(v);
        return;
      }
      if (!isTop) return;
      if (v.step.kind === 'navigate' && urlMatches(v.step.url, url, v.appOrigins)) op('done');
    },
    dispose() {
      offReleased();
      clearStep();
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // context gone
      }
    },
  };
}
