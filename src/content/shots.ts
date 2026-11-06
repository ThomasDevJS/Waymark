/**
 * Content side of step screenshots (D183). The service worker takes the picture; this only hides
 * what must not be in it, for the moment of the capture, and says where things are:
 * - Waymark's own UI (the REC pill, a Test step spotlight, any outline): the whole overlay host;
 * - the text inside fields (inputs, text areas, editable areas), in the document and in every
 *   shadow root, open or closed, so nothing typed is ever in an image. Placeholders stay: they
 *   are labels, not data.
 * - The top frame answers with the step's own element, measured now (null when it is gone or
 *   hidden: then no picture is taken), and the areas of iframes, whose fields this frame can't
 *   hide: the service worker paints over them.
 * The page's DOM is not changed: a constructed style sheet is adopted, then removed. Nothing
 * here sees an image; the page learns only that a short-lived sheet was adopted.
 */
import type { ContentPush } from '../core/messaging/protocol';
import { isVisible } from '../core/fingerprint/dom';
import { setOverlayHidden } from './overlay/host';
import { flashPill } from './overlay/pill';
import { testMark } from './test-hooks';

/** The hint in the REC pill when Chrome refuses a screenshot (D186). */
export const SHOT_HINT = 'Screenshots need one click on the Waymark icon (or Alt+W) on this tab.';

/** Shown again on its own if the service worker never says the capture is over. */
export const RESTORE_MS = 2500;
/** Elements remembered for screenshots (recorded or tested steps); the oldest go first. */
export const MAX_TARGETS = 20;
/** Iframe areas reported per capture. */
export const MAX_FRAMES = 50;

const TEXT_INPUTS = 'input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=image]):not([type=range]):not([type=color]):not([type=file])';
export const FIELD_CSS = `
${TEXT_INPUTS}, textarea, [contenteditable]:not([contenteditable="false"]), [contenteditable]:not([contenteditable="false"]) * {
  color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }
input::placeholder, textarea::placeholder { color: GrayText !important; -webkit-text-fill-color: GrayText !important; }
`;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the top frame answers to shot.hide (the service worker checks it again). */
export interface ShotView {
  vw: number;
  vh: number;
  dpr: number;
  /** The step's element in viewport coordinates, or null: gone, hidden or unknown. */
  rect: Box | null;
  /** Iframes and other embedded documents in view, in viewport coordinates. */
  frames: Box[];
}

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

/** The document and every shadow root inside it, with the embedded documents in view. */
function scan(): { roots: (Document | ShadowRoot)[]; frames: Box[] } {
  const roots: (Document | ShadowRoot)[] = [document];
  const frames: Box[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (let i = 0; i < roots.length; i++) {
    for (const el of roots[i]!.querySelectorAll('*')) {
      const sr = shadowOf(el);
      if (sr) roots.push(sr);
      if (frames.length < MAX_FRAMES && /^(IFRAME|FRAME|OBJECT|EMBED)$/.test(el.tagName)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh) frames.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }
  }
  return { roots, frames };
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

/** Hides Waymark's UI and field text for a capture. Returns the iframe areas in view. */
export function hideForShot(): Box[] {
  setOverlayHidden(true);
  const s = fieldSheet();
  const { roots, frames } = scan();
  if (s) for (const root of roots) adopt(root, s);
  restartRestore();
  testMark('shot-hidden', '1');
  return frames;
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
      const frames = hideForShot();
      // The top frame answers once the page is painted without Waymark. Frames only hide.
      if (!isTop) return false;
      const stepId = typeof m.payload?.stepId === 'string' ? m.payload.stepId : undefined;
      void painted().then(() => {
        // The capture starts now: everything stays hidden for the full restore time from here.
        restartRestore();
        sendResponse({ vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio, rect: shotTargetRect(stepId), frames });
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
