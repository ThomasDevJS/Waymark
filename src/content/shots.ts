/**
 * Content side of step screenshots (D183, D191, D192). The service worker takes the picture of
 * the whole visible tab; every frame Waymark runs in hides what must not be in it for the moment
 * of the capture, and says where things are:
 * - Waymark's own UI (the REC pill, a Test step spotlight, any outline): the whole overlay host;
 * - the text inside fields (inputs, text areas, editable areas), in the document and in every
 *   shadow root, open or closed, so nothing typed is ever in an image. Placeholders stay: they
 *   are labels, not data.
 * - Each frame answers once the hidden state is painted, with its viewport, the step's element
 *   when it was asked for it (null when gone or hidden: then no picture is taken), and the
 *   embedded documents in its view with their frame ids (chrome.runtime.getFrameId) and boxes.
 *   The service worker places frames from that, and paints over every embedded document whose
 *   own frame did not answer (no Waymark there, so its fields could not be hidden).
 * The page's DOM is not changed: a constructed style sheet is adopted, then removed. Nothing
 * here sees an image; the page learns only that a short-lived sheet was adopted.
 */
import type { ContentPush } from '../core/messaging/protocol';
import type { Box, ChildFrame, FrameReport } from '../core/shots/place';
import { isVisible } from '../core/fingerprint/dom';
import { hostSelector } from '../core/fingerprint';
import { setOverlayHidden } from './overlay/host';
import { flashPill } from './overlay/pill';
import { testMark } from './test-hooks';

/** The hint in the REC pill when Chrome refuses a screenshot (D186). */
export const SHOT_HINT = 'Screenshots need one click on the Waymark icon (or Alt+W) on this tab.';

/** Shown again on its own if the service worker never says the capture is over. */
export const RESTORE_MS = 2500;
/** Elements remembered for screenshots (recorded or tested steps); the oldest go first. */
export const MAX_TARGETS = 20;
/** Embedded documents reported per frame; with more in view the capture is refused. */
export const MAX_FRAMES = 100;

const TEXT_INPUTS = 'input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=image]):not([type=range]):not([type=color]):not([type=file])';
export const FIELD_CSS = `
${TEXT_INPUTS}, textarea, [contenteditable]:not([contenteditable="false"]), [contenteditable]:not([contenteditable="false"]) * {
  color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }
input::placeholder, textarea::placeholder { color: GrayText !important; -webkit-text-fill-color: GrayText !important; }
`;

export type { Box };
/** What a frame answers to shot.hide (the service worker checks it again). */
export type ShotView = FrameReport;

let sheet: CSSStyleSheet | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Where the sheet was adopted: the document and shadow roots. */
let adopted: (Document | ShadowRoot)[] = [];
const targets = new Map<string, WeakRef<Element>>();

function fieldSheet(): CSSStyleSheet | null {
  if (sheet) return sheet;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(FIELD_CSS);
  } catch {
    sheet = null;
  }
  return sheet;
}

/** Remembers the element of a step, so its screenshot measures it at capture time. */
export function rememberShotTarget(stepId: string, el: Element): void {
  targets.delete(stepId);
  targets.set(stepId, new WeakRef(el));
  while (targets.size > MAX_TARGETS) targets.delete(targets.keys().next().value!);
}

function shadowOf(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  try {
    // Closed roots: content scripts may open them (chrome.dom).
    const dom = (globalThis as { chrome?: { dom?: { openOrClosedShadowRoot?: (e: HTMLElement) => ShadowRoot | null } } }).chrome?.dom;
    return dom?.openOrClosedShadowRoot?.(el as HTMLElement) ?? null;
  } catch {
    return null;
  }
}

function safeSelector(el: Element): string | null {
  try {
    const s = hostSelector(el);
    return s.length <= 2000 ? s : null;
  } catch {
    return null;
  }
}

/** An embedded document's border box, content box and CSS scale, in this frame's viewport. */
export function childFrame(el: Element): ChildFrame {
  const r = el.getBoundingClientRect();
  const he = el as HTMLElement;
  const k = he.offsetWidth > 0 ? r.width / he.offsetWidth : 1;
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  const pl = px(cs.paddingLeft);
  const pt = px(cs.paddingTop);
  const cw = Math.max(0, he.clientWidth - pl - px(cs.paddingRight));
  const ch = Math.max(0, he.clientHeight - pt - px(cs.paddingBottom));
  // Frames are named as the frame registry names them (frames.ts): the service worker finds the
  // child's frameId from (this frame, selector). Objects and embeds have none: always masked.
  const sel = /^(IFRAME|FRAME)$/.test(el.tagName) ? safeSelector(el) : null;
  return {
    frameId: -1,
    ...(sel ? { sel } : {}),
    box: { x: r.left, y: r.top, w: r.width, h: r.height },
    content: { x: r.left + (he.clientLeft + pl) * k, y: r.top + (he.clientTop + pt) * k, w: cw * k, h: ch * k },
    k: Number.isFinite(k) && k > 0 ? k : 1,
  };
}

/** The document and every shadow root inside it, with the embedded documents in view. */
function scan(): { roots: (Document | ShadowRoot)[]; frames: ChildFrame[]; more: boolean } {
  const roots: (Document | ShadowRoot)[] = [document];
  const frames: ChildFrame[] = [];
  let more = false;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (let i = 0; i < roots.length; i++) {
    for (const el of roots[i]!.querySelectorAll('*')) {
      const sr = shadowOf(el);
      if (sr) roots.push(sr);
      if (/^(IFRAME|FRAME|OBJECT|EMBED)$/.test(el.tagName)) {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh)) continue;
        if (frames.length >= MAX_FRAMES) more = true;
        else frames.push(childFrame(el));
      }
    }
  }
  return { roots, frames, more };
}

function adopt(root: Document | ShadowRoot, s: CSSStyleSheet): void {
  try {
    if (!root.adoptedStyleSheets.includes(s)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, s];
    adopted.push(root);
  } catch {
    // a root that refuses it: nothing more to do here
  }
}

function restartRestore(): void {
  clearTimeout(timer);
  timer = setTimeout(showAfterShot, RESTORE_MS);
}

/** Hides Waymark's UI and field text for a capture. Returns the embedded documents in view. */
export function hideForShot(): { frames: ChildFrame[]; more: boolean } {
  setOverlayHidden(true);
  const s = fieldSheet();
  const found = scan();
  const { roots, frames } = found;
  let more = found.more;
  // Without the sheet, field text could not be hidden: say so, and the frame is painted over.
  if (!s) more = true;
  else for (const root of roots) adopt(root, s);
  restartRestore();
  testMark('shot-hidden', '1');
  return { frames, more };
}

export function showAfterShot(): void {
  clearTimeout(timer);
  setOverlayHidden(false);
  for (const root of adopted) {
    try {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter((x) => x !== sheet);
    } catch {
      // gone
    }
  }
  adopted = [];
  testMark('shot-hidden', '0');
}

/** The remembered element of a step, now, in viewport coordinates; null when gone or hidden. */
export function shotTargetRect(stepId: string | undefined): Box | null {
  const el = stepId ? targets.get(stepId)?.deref() : undefined;
  if (!el?.isConnected || !isVisible(el)) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Resolves once the hidden state has been painted (two frames), or after `maxMs`. */
function painted(maxMs = 250): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, maxMs);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(t);
        resolve();
      }),
    );
  });
}

export function startShotClient(): { dispose(): void } {
  const isTop = window === window.top;
  const onMessage = (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: ShotView) => void) => {
    // Only the service worker (no tab) of this extension.
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    const m = msg as ContentPush;
    if (m?.type === 'shot.hide') {
      const hidden = hideForShot();
      const stepId = typeof m.payload?.stepId === 'string' ? m.payload.stepId : undefined;
      // Every frame answers once it is painted without Waymark and without field text (D192).
      void painted().then(() => {
        // The capture starts now: everything stays hidden for the full restore time from here.
        restartRestore();
        // Measured after painting: the layout of the moment of the capture.
        const now = scan();
        // A shadow root made meanwhile gets the sheet too.
        const s = fieldSheet();
        if (s) for (const root of now.roots) if (!adopted.includes(root)) adopt(root, s);
        sendResponse({
          vw: window.innerWidth,
          vh: window.innerHeight,
          dpr: window.devicePixelRatio,
          rect: shotTargetRect(stepId),
          frames: now.frames,
          ...(hidden.more || now.more ? { more: true } : {}),
        });
      });
      return true;
    }
    if (m?.type === 'shot.show') showAfterShot();
    else if (m?.type === 'shot.hint' && isTop) flashPill(SHOT_HINT);
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  return {
    dispose() {
      showAfterShot();
      targets.clear();
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // context gone
      }
    },
  };
}
