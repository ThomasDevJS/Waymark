/**
 * Content side of the editor (SPEC: User flows, Edit 2-3): Test step highlights the matched
 * element on the current page; Re-pick element lets the author click the right element.
 */
import { send } from '../core/messaging/client';
import type { ContentPush } from '../core/messaging/protocol';
import { buildFingerprint, resolveTargetFromPath } from '../core/fingerprint';
import { waitForMatch, STRONG } from '../core/matcher';
import { NO_RUN } from '../core/player/run';
import { roleWord, stepTitle } from '../core/text/templates';
import type { TestResult } from '../background/editor';
import { isOverlayPath, mountOverlayIn, overlayLayer, overlayRoot } from './overlay/host';
import { PlayerUI, openModalDialog } from './player/ui';
import { testMark } from './test-hooks';

const PICK_CSS = `
.pick-box { position: fixed; border: 2px dashed #e8710a; background: rgba(232,113,10,.08); pointer-events: none; border-radius: 4px; box-sizing: border-box; }
.pick-banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: #1d1f23; color: #fff; padding: 6px 14px; border-radius: 999px;
  font: 13px/1.4 system-ui, sans-serif; pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
`;

const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'];

export function startEditorClient(framePath: () => string[]): { dispose(): void } {
  const isTop = window === window.top;
  let picking = false;
  let box: HTMLElement | null = null;
  let banner: HTMLElement | null = null;
  let testUi: PlayerUI | null = null;
  let testTimer: ReturnType<typeof setTimeout> | undefined;

  const onMove = (e: Event) => {
    if (isOverlayPath(e.composedPath())) return;
    const t = resolveTargetFromPath(e.composedPath());
    if (!t || !box) return;
    const r = t.element.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, display: 'block' });
  };

  // The click that picks must not reach the app (it would run the app's action).
  const block = (e: Event) => {
    if (isOverlayPath(e.composedPath())) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click' && e.isTrusted) choose(e.composedPath());
  };

  const onKey = (e: KeyboardEvent) => {
    // Only the user's own Escape cancels: a page cannot dispatch one to stop a pick (D47).
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
    const fp = buildFingerprint(t.element, { framePath: framePath() });
    const name = fp.accessibleName ?? fp.text ?? fp.placeholder ?? fp.name ?? roleWord(fp.role);
    send('pick.result', { target: fp, title: stepTitle('click', { name }) }).catch(() => undefined);
    testMark('picked', fp.text ?? fp.accessibleName ?? fp.tag);
    stopPick();
  }

  function startPick() {
    if (picking) return;
    picking = true;
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

  async function testStep(step: Parameters<PlayerUI['showStep']>[0]['step']): Promise<TestResult> {
    if (!step?.target) return { found: false, score: 0, margin: 0, matched: [], fragile: false, reason: 'This step has no element.' };
    const r = await waitForMatch(document, step.target, { timeoutMs: 3000 });
    clearTimeout(testTimer);
    testUi?.clear();
    if (r.status !== 'found') {
      testMark('tested', 'not-found');
      return { found: false, score: r.bestScore, margin: 0, matched: r.matched, fragile: false, reason: `Not found (${r.reason}).` };
    }
    const strong = r.matched.filter((k) => STRONG.has(k));
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
    testUi.flash(`Matched: ${r.matched.join(', ')} (score ${Math.round(r.score)})`);
    testTimer = setTimeout(() => testUi?.clear(), 4000);
    testMark('tested', 'found');
    return { found: true, score: r.score, margin: r.margin, matched: r.matched, fragile: strong.length <= 1 };
  }

  const onMessage = (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: TestResult) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    const m = msg as ContentPush;
    if (m?.type === 'pick.start') startPick();
    else if (m?.type === 'pick.stop') stopPick();
    else if (m?.type === 'test.step' && m.payload?.step) {
      void testStep(m.payload.step).then(sendResponse);
      return true; // async response
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
