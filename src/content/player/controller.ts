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
import { FIX_TTL_MS, type RunOp, type RunView } from '../../core/player/run';
import { urlMatches } from '../../core/url/url';
import { isOverlayPath, onOverlayReleased } from '../overlay/host';
import { testMark, testSpot } from '../test-hooks';
import { bestSpeechVoice } from '../../core/voice/voice';
import { presentSignals } from '../../core/matcher/signals';
import { dlog, debugOn, flushDebug } from '../debug';
import { PlayerUI } from './ui';
import { reducedMotion } from '../../ui/motion';

/** Why the matcher gave up, in words, for the debug log (D110). */
const NOT_FOUND_WHY: Record<string, string> = {
  'no-candidates': 'no visible, enabled element shares any signal',
  'no-strong-signal': 'the best candidate matched no strong signal',
  'below-threshold': 'the best score is below 60',
  ambiguous: 'two candidates are too close (under 15 points apart, or only position differs)',
  lookalike: 'the best candidate matched nothing a look-alike seen at record time lacked (D64)',
};

/** Why Pick the right element did not start, in words (D210). */
export const FIX_REFUSED: Record<'step' | 'guide' | 'page', string> = {
  step: 'This step changed in the meantime. Press Retry, then try again.',
  guide: 'Only your own guides can be fixed here. Use Duplicate in the side panel to make your own copy.',
  page: 'Waymark can’t pick an element on this page. Reload it and try again.',
};

/** Writes text to the clipboard from a click in the page; false when the page does not allow it. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** After any action, wait 300 ms before searching for the next target (SPEC: Advancing). */
export const AFTER_ACTION_MS = 300;
/** Off track: the page does not match the step's URL rule and the target is missing for 3 s. */
export const OFF_TRACK_MS = 3000;

export interface PlayerDeps {
  frameToken: string;
  framePath: () => string[];
  /** Tests only: browser-mode Vitest runs inside an iframe, so it says it is the top frame. */
  isTop?: boolean;
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
  const isTop = deps.isTop ?? window === window.top;
  let view: RunView | null = null;
  let stepToken: string | null = null;
  let abort: AbortController | null = null;
  let result: MatchResult | null = null;
  let searchDone = false;
  let stopAdvance: (() => void) | null = null;
  let drawnFor: string | null = null;
  /** The step token a pick from the player is under way for (D210); the player hides meanwhile. */
  let fixingFor: string | null = null;
  let fixTimer: ReturnType<typeof setTimeout> | undefined;
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
        .then(() => ui.flash('Thanks. The broken step was saved to the Problems list in Waymark’s Settings.'))
        .catch(() => undefined);
    },
    goBack: () => history.back(),
    // Pick the right element (D210): the service worker checks it is the author's own guide and
    // the current step, then every frame enters pick mode and the player hides.
    fix: () => {
      const v = view;
      if (!v?.step || v.status !== 'running') return;
      dlog('play', 'fix.ask', { step: v.stepIndex + 1 });
      send('run.fix.start', { stepId: v.step.id })
        .then((r) => {
          if (!r.ok) ui.flash(FIX_REFUSED[r.why ?? 'page'], 'warn');
        })
        .catch(() => undefined);
    },
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
      dlog('play', 'repeat', { step: v.stepIndex + 1 });
      startSearch(v);
      send('run.replay', { stepId: v.step.id }).catch(() => undefined);
    },
    // Not-found card, only while the debug log is on (D111): this tab's entries since the guide
    // started, on this site. The page may not allow the clipboard; Settings has the full log.
    debugOn,
    copyLog: async () => {
      await flushDebug();
      const r = await send('debug.copy', {}).catch(() => ({ text: null }));
      const ok = !!r.text && (await copyText(r.text));
      testMark('debug-copy', r.text ? (ok ? 'copied' : 'blocked') : 'none');
      if (__WAYMARK_TEST__ && r.text) testMark('debug-copy-text', r.text);
      ui.flash(ok ? 'Debug log copied. Paste it into the chat.' : 'Couldn’t copy here. Use Settings → Problems → Copy debug log.', ok ? 'success' : 'warn');
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

  // The board our last report went into, and whether a report is on its way (#36): render() resends
  // only when the view shows a board that is not the one holding our report (D45: it was replaced).
  let reportedTo: string | null = null;
  let reportInFlight = false;
  let resends = 0;
  let reportSeq = 0;
  const report = (v: RunView, r: MatchResult) => {
    const fp = v.step?.target;
    const seq = ++reportSeq;
    reportInFlight = true;
    send('run.match', {
      stepToken: v.stepToken ?? '',
      frameToken: deps.frameToken,
      found: r.status === 'found',
      score: r.status === 'found' ? r.score : r.bestScore,
      margin: r.status === 'found' ? r.margin : 0,
      instance: fp?.instance ?? 'unique',
      pathMatches: !!fp && JSON.stringify(deps.framePath()) === JSON.stringify(fp.framePath),
    })
      .then((res) => {
        if (seq !== reportSeq) return; // a newer report (or search) took over
        reportInFlight = false;
        reportedTo = res?.boardId ?? null;
        render(); // a view may have come while the report was on its way
      })
      .catch(() => {
        if (seq === reportSeq) reportInFlight = false;
      });
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
    // A new search: no report of it yet (#36). The board's own reports stay; this one replaces ours.
    reportSeq++;
    reportInFlight = false;
    reportedTo = null;
    resends = 0;
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
          dlog('play', 'card.off-track', () => ({ step: v.stepIndex + 1, why: `not found for ${OFF_TRACK_MS / 1000} s and the page is not the step’s page`, expected: v.step?.url.value ?? null }));
          ui.showCard('off-track', view);
          testMark('player', `off-track:${v.stepIndex}`);
        }
      }, OFF_TRACK_MS);
    }
    const started = Date.now();
    const fp = step.target;
    dlog('match', 'search', () => ({
      step: v.stepIndex + 1,
      kind: step.kind,
      signals: presentSignals(fp),
      instance: fp.instance,
      frame: deps.framePath().length ? 'iframe' : 'top',
      pathMatches: JSON.stringify(deps.framePath()) === JSON.stringify(fp.framePath),
    }));
    void waitForMatch(document, step.target, { signal: ac.signal }).then((r) => {
      if (ac.signal.aborted || view?.stepToken !== v.stepToken) return;
      dlog('match', r.status, () =>
        r.status === 'found'
          ? { step: v.stepIndex + 1, score: r.score, margin: r.margin, matched: r.matched, via: r.via, tied: r.tied.length, tag: r.element.tagName.toLowerCase(), ms: Date.now() - started }
          : { step: v.stepIndex + 1, reason: r.reason, why: NOT_FOUND_WHY[r.reason] ?? r.reason, best: r.bestScore, runnerUp: r.runnerUpScore, margin: r.bestScore - r.runnerUpScore, matched: r.matched, ms: Date.now() - started },
      );
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
    if (!v.winner && searchDone && result && v.step.target && !reportInFlight && v.boardId !== reportedTo && resends < 3) {
      resends++;
      dlog('frame', 'report.again', { step: v.stepIndex + 1, why: 'the board holding this frame’s report was replaced (D45)' });
      report(v, result);
    }
    const mine = v.winner === deps.frameToken && result?.status === 'found';
    if (mine && drawnFor !== v.stepToken && result?.status === 'found') {
      const r = result;
      // Draw on the box the learner can see (a visually hidden control is shown through its
      // label, R7); for repeated elements the matcher picks the first visible tied candidate.
      const target = r.spotlight ?? r.tied.find((e) => isVisible(e)) ?? r.element;
      const rect = target.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
      ui.showStep(v, target, () => {
        // target removed or re-rendered: match again on the same step
        if (view?.stepToken === v.stepToken) startSearch(view);
      });
      drawnFor = v.stepToken;
      stopAdvance?.();
      // A click on the spotlighted box (e.g. the label of a hidden checkbox) also counts.
      const targets = r.tied.includes(target) ? r.tied : [...r.tied, target];
      stopAdvance = watchAdvance({ step: v.step, targets, isOwnEvent: isOverlayPath, onAdvance: () => op('done'), ...(debugOn() ? { debug: (ev: string, d: () => Record<string, unknown>) => dlog('play', ev, d) } : {}) });
      dlog('play', 'draw', () => ({ step: v.stepIndex + 1, why: 'this frame won', spotlight: target === r.element ? 'element' : 'its label or box' }));
      testSpot(target, v.stepIndex);
      testMark('player', `drawn:${v.stepIndex}`);
      testMark('draws', String(Number(document.documentElement.getAttribute('data-waymark-test-draws') ?? 0) + 1));
      return;
    }
    // Another frame found the target: the top frame's off-track or not-found card goes away.
    if (!mine && v.winner && (ui.card === 'off-track' || ui.card === 'not-found')) {
      dlog('play', 'card.cleared', { step: v.stepIndex + 1, why: 'another frame found the element' });
      ui.clear();
      testMark('player', `elsewhere:${v.stepIndex}`);
    }
    if (!mine && drawnFor === v.stepToken && v.step.target) {
      dlog('play', 'undraw', { step: v.stepIndex + 1, why: 'another frame won' });
      ui.clear();
      stopAdvance?.();
      stopAdvance = null;
      drawnFor = null;
      testSpot(null);
    }
    // The top frame shows "not found" when its own search gave up and no frame found the target.
    if (isTop && searchDone && result?.status === 'not-found' && !v.winner && onStartPageUrl(v)) {
      if (ui.card !== 'not-found') dlog('play', 'card.not-found', { step: v.stepIndex + 1, why: 'the top frame gave up and no frame found it' });
      ui.showCard('not-found', v);
      testMark('player', `not-found:${v.stepIndex}`);
    }
  }

  const endFixing = () => {
    fixingFor = null;
    clearTimeout(fixTimer);
  };

  const apply = (next: RunView) => {
    // Views can arrive out of order (a reply to a page-load report vs. a push): keep the newest.
    if (view && next.runId && view.runId === next.runId && next.rev < view.rev) return;
    view = next;
    ui.setMuted(next.muted);
    ui.setShade(next.shade);
    if (next.fixing && next.status === 'running' && next.stepToken) {
      // The author is picking the right element (D210): nothing of the player covers the page.
      if (fixingFor !== next.stepToken) {
        clearStep();
        stepToken = next.stepToken;
        fixingFor = next.stepToken;
        clearTimeout(fixTimer);
        // The service worker stops accepting the pick then: leave pick mode with it.
        if (isTop) fixTimer = setTimeout(() => send('pick.abort', {}).catch(() => undefined), FIX_TTL_MS);
        dlog('play', 'fix.picking', { step: next.stepIndex + 1 });
        testMark('player', `fixing:${next.stepIndex}`);
      }
      return;
    }
    if (fixingFor) {
      const was = fixingFor;
      endFixing();
      // Cancelled (Esc, a refused element, a timeout): the same step is searched for again, so the
      // card or the highlight comes back. A fix gives the step a new token (handled below).
      if (next.status === 'running' && next.stepToken === was) {
        stepToken = next.stepToken;
        startSearch(next);
        return;
      }
    }
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
      dlog('play', 'step.view', () => ({ step: next.stepIndex + 1, of: next.total, kind: next.step?.kind ?? null, cause: next.cause, waitMs: next.cause === 'action' ? AFTER_ACTION_MS : 0 }));
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

  const onMessage = (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    const m = msg as ContentPush;
    if (m?.type === 'frame.alive') return void sendResponse(true);
    if (m?.type === 'run.changed' && m.payload && typeof m.payload.active === 'boolean') apply(m.payload);
    else if (m?.type === 'tts.content' && isTop) speakFallback(m.payload);
    else if (m?.type === 'tts.stop' && isTop) window.speechSynthesis?.cancel();
  };
  chrome.runtime.onMessage.addListener(onMessage);

  // This document is going away (its iframe removed, or a navigation): its match reports must not
  // block the frame that replaces it (D84). Only after this frame has reported for the step.
  const onHide = () => {
    if (searchDone) send('run.leave', {}).catch(() => undefined);
  };
  addEventListener('pagehide', onHide);

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
      // An in-app route change ends the player's pick; the usual off-track rules apply (D210).
      if (fixingFor) {
        if (isTop) send('pick.abort', {}).catch(() => undefined);
        return;
      }
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
      endFixing();
      clearStep();
      removeEventListener('pagehide', onHide);
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // context gone
      }
    },
  };
}
