/**
 * Content side of the editor (SPEC: User flows, Edit 2-3): Test step highlights the matched
 * element on the current page; Re-pick element lets the author click the right element.
 */
import { send } from '../core/messaging/client';
import type { ContentPush } from '../core/messaging/protocol';
import { buildFingerprint, resolveTargetFromPath, type ResolvedTarget } from '../core/fingerprint';
import type { ElementFingerprint } from '../core/model/schema';
import { promoteToRegion } from '../core/recorder/region';
import { hasStrongSignal } from '../core/matcher/signals';
import { rememberShotTarget } from './shots';
import { waitForMatch } from '../core/matcher';
import { isFragile, matchStrength } from '../core/stats/plays';
import { NO_RUN } from '../core/player/run';
import { roleWord, stepTitle } from '../core/text/templates';
import type { TestResult } from '../background/editor';
import { eventPath, isOverlayPath, mountOverlayIn, overlayLayer, overlayRoot } from './overlay/host';
import { PlayerUI, openModalDialog } from './player/ui';
import { testMark } from './test-hooks';
import { fetchProfile } from './profile';
import type { ProfileOptions } from '../core/model/profile';
import type { AttrCandidate } from '../core/messaging/protocol';
import { scanAttributes } from '../core/fingerprint/candidates-scan';

/** Pick banner after a click on something Waymark could not find again (issue #6). */
export const PICK_REJECTED = 'Waymark could not find that again. Click a button, link or field · Esc to cancel';

const PICK_CSS = `
.pick-box { position: fixed; border: 2px dashed #e8710a; background: rgba(232,113,10,.10); pointer-events: none; border-radius: 6px; box-sizing: border-box;
  box-shadow: 0 0 0 2px rgba(255,255,255,.8); }
.pick-banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 32px); box-sizing: border-box;
  background: var(--wm-surface); color: var(--wm-fg); border: 1px solid var(--wm-border); padding: 8px 16px; border-radius: 999px;
  font: 500 13px/1.4 var(--wm-font); pointer-events: none; box-shadow: var(--wm-shadow-3); text-align: center; }
.pick-banner::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #e8710a; margin-right: 8px; vertical-align: 1px; }
@media (forced-colors: active) { .pick-box { border-color: Highlight; } .pick-banner { border: 1px solid CanvasText; } }
`;

const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'];

export function startEditorClient(framePath: () => string[]): { dispose(): void } {
  const isTop = window === window.top;
  let picking = false;
  let box: HTMLElement | null = null;
  let banner: HTMLElement | null = null;
  let testUi: PlayerUI | null = null;
  let testTimer: ReturnType<typeof setTimeout> | undefined;
  // The author's own profile for this site (D213), fetched when a pick starts.
  let profile: ProfileOptions = {};
  // A click waits for it, so the picked fingerprint always has the profile (D213 review).
  let profileReady: Promise<void> = Promise.resolve();

  // What a click here would pick, with the clickable region of D82 applied. Memoized on the
  // hovered element: the promotion builds a fingerprint, too costly for every mouse move.
  let lastHover: { from: Element; pick: { element: Element; fp?: ElementFingerprint; name?: string } } | null = null;
  const pickFor = (t: ResolvedTarget) => {
    if (lastHover?.from === t.element) return lastHover.pick;
    const up = promoteToRegion(t, (el) => buildFingerprint(el, { framePath: framePath(), profile }));
    const pick: { element: Element; fp?: ElementFingerprint; name?: string } = up ?? { element: t.element };
    lastHover = { from: t.element, pick };
    return pick;
  };

  const onMove = (e: Event) => {
    if (isOverlayPath(eventPath(e))) return;
    const t = resolveTargetFromPath(eventPath(e));
    if (!t || !box) return;
    const r = pickFor(t).element.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, display: 'block' });
  };

  // The click that picks must not reach the app (it would run the app's action).
  const block = (e: Event) => {
    if (isOverlayPath(eventPath(e))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click' && e.isTrusted) {
      const path = eventPath(e);
      void profileReady.then(() => {
        if (picking) choose(path);
      });
    }
  };

  const onKey = (e: KeyboardEvent) => {
    // Only the user's own Escape cancels: a page cannot dispatch one to stop a pick (D48).
    if (e.key === 'Escape' && e.isTrusted) {
      e.stopImmediatePropagation();
      stopPick();
      // Every frame and the side panel stop waiting.
      send('pick.abort', {}).catch(() => undefined);
    }
  };

  function choose(path: EventTarget[]) {
    const t = resolveTargetFromPath(path);
    if (!t) {
      stopPick();
      send('pick.abort', {}).catch(() => undefined);
      return;
    }
    // Plain content inside a clickable card picks the card, as the recorder does (D82).
    lastHover = null;
    const pick = pickFor(t);
    const hint = pick.name;
    const fp = pick.fp ?? buildFingerprint(pick.element, { framePath: framePath(), profile });
    if (!hasStrongSignal(fp)) {
      // It could never be found again (issue #6): keep picking and say why.
      if (banner) banner.textContent = PICK_REJECTED;
      testMark('pick-rejected', fp.tag);
      return;
    }
    const name = hint ?? fp.accessibleName ?? fp.text ?? fp.placeholder ?? fp.name ?? fp.itemLabel ?? roleWord(fp.role);
    send('pick.result', { target: fp, title: stepTitle('click', { name }) }).catch(() => undefined);
    testMark('picked', fp.text ?? fp.accessibleName ?? fp.tag);
    stopPick();
  }

  function startPick() {
    if (picking) return;
    picking = true;
    lastHover = null;
    profileReady = fetchProfile('edit').then((p) => {
      profile = p;
      lastHover = null; // the outline is worked out again with the profile
    });
    const root = overlayRoot();
    mountOverlayIn(openModalDialog());
    if (!root.querySelector('style[data-pick]')) {
      const style = document.createElement('style');
      style.dataset.pick = '';
      style.textContent = PICK_CSS;
      root.append(style);
    }
    box = document.createElement('div');
    box.className = 'pick-box';
    box.style.display = 'none';
    overlayLayer().append(box);
    if (isTop) {
      banner = document.createElement('div');
      banner.className = 'pick-banner';
      banner.textContent = 'Click the element for this step · Esc to cancel';
      overlayLayer().append(banner);
    }
    window.addEventListener('pointermove', onMove, true);
    for (const t of BLOCKED) window.addEventListener(t, block, true);
    window.addEventListener('keydown', onKey, true);
    testMark('picking', 'on');
  }

  function stopPick() {
    if (!picking) return;
    picking = false;
    window.removeEventListener('pointermove', onMove, true);
    for (const t of BLOCKED) window.removeEventListener(t, block, true);
    window.removeEventListener('keydown', onKey, true);
    box?.remove();
    banner?.remove();
    box = banner = null;
    testMark('picking', 'off');
  }

  async function testStep(step: Parameters<PlayerUI['showStep']>[0]['step'], wantShot = false, quiet = false): Promise<TestResult> {
    if (!step?.target) return { found: false, score: 0, margin: 0, matched: [], fragile: false, reason: 'This step has no element to find.' };
    // With the site's profile, as the player uses it (D213).
    const r = await waitForMatch(document, step.target, { timeoutMs: quiet ? 1500 : 3000, profile: await fetchProfile('edit') });
    if (quiet) {
      // Test all steps on this page (D213): the result only, nothing drawn.
      return r.status === 'found' ? { found: true, score: r.score, margin: r.margin, matched: r.matched, fragile: isFragile(matchStrength(r)) } : { found: false, score: r.bestScore, margin: 0, matched: r.matched, fragile: false };
    }
    clearTimeout(testTimer);
    testUi?.clear();
    if (r.status !== 'found') {
      testMark('tested', 'not-found');
      return { found: false, score: r.bestScore, margin: 0, matched: r.matched, fragile: false, reason: 'Nothing on this page matches this step. Check that this is the right page, or Re-pick element.' };
    }
    // The same rule as the plays' "Found by one signal only" (D211).
    const fragile = isFragile(matchStrength(r));
    testUi = new PlayerUI({
      next: () => testUi?.clear(),
      back() {},
      skip() {},
      exit: () => testUi?.clear(),
      retry() {},
      report() {},
      goBack() {},
      mute() {},
    });
    const target = r.spotlight ?? r.element;
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    testUi.showStep({ ...NO_RUN, active: true, status: 'running', guideTitle: 'Test step', stepIndex: 0, total: 1, step: { ...step, advance: 'action' }, stepToken: 'test' }, target);
    testUi.flash(fragile ? 'Found, but fragile. The details are in the side panel.' : 'Found. The details are in the side panel.');
    testTimer = setTimeout(() => testUi?.clear(), 4000);
    testMark('tested', 'found');
    const out: TestResult = { found: true, score: r.score, margin: r.margin, matched: r.matched, fragile };
    // For the step's screenshot (D187): the service worker measures this element at capture time.
    // In frames too (D191): the service worker places it through its frames.
    if (wantShot) rememberShotTarget(step.id, target);
    return out;
  }

  const onMessage = (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: TestResult) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    const m = msg as ContentPush;
    if (m?.type === 'pick.start') startPick();
    else if (m?.type === 'pick.stop') stopPick();
    else if (m?.type === 'test.step' && m.payload?.step) {
      void testStep(m.payload.step, m.payload.shot === true, m.payload.quiet === true).then(sendResponse);
      return true; // async response
    } else if (m?.type === 'profile.scan' && isTop) {
      (sendResponse as unknown as (r: AttrCandidate[]) => void)(scanAttributes(document));
      return false;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);

  return {
    dispose() {
      stopPick();
      clearTimeout(testTimer);
      testUi?.clear();
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // context gone
      }
    },
  };
}
