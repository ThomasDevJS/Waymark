/**
 * Overlay host (SPEC: Player and overlay, "Overlay"): one host element with a closed shadow
 * root (open in test builds), shown as a manual popover so it sits in the top layer above any
 * z-index. Pointer, mouse and click events inside it do not reach the app.
 */
const HOST_TAG = 'waymark-overlay';
let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

const ISOLATED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'];

const BASE_CSS = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; font: 13px/1.4 system-ui, sans-serif; }
`;

/**
 * Moves the host into `container` (an open modal <dialog>, whose inertness would otherwise
 * block the tooltip) or back to the document, and re-shows it in the top layer.
 */
export function mountOverlayIn(container: Element | null): void {
  overlayRoot();
  if (!host) return;
  const parent = container ?? document.documentElement;
  if (host.parentNode === parent) return;
  parent.appendChild(host);
  try {
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  } catch {
    // ignore
  }
}

export function overlayHost(): HTMLElement | null {
  return host;
}

export function overlayRoot(): ShadowRoot {
  if (root && host?.isConnected) return root;
  host = document.createElement(HOST_TAG);
  host.setAttribute('popover', 'manual');
  host.style.cssText =
    'all: initial !important; display: block !important; position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; overflow: visible !important; pointer-events: none !important; z-index: 2147483647 !important;';
  root = host.attachShadow({ mode: __WAYMARK_TEST__ ? 'open' : 'closed' });
  const style = document.createElement('style');
  style.textContent = BASE_CSS;
  const layer = document.createElement('div');
  layer.className = 'layer';
  root.append(style, layer);
  for (const type of ISOLATED_EVENTS) host.addEventListener(type, (e) => e.stopPropagation());
  (document.documentElement ?? document).appendChild(host);
  try {
    host.showPopover();
  } catch {
    // popover unsupported or document not ready: still rendered with a max z-index
  }
  return root;
}

export function overlayLayer(): HTMLElement {
  return overlayRoot().querySelector('.layer') as HTMLElement;
}

/** True when an event path goes through Waymark's overlay. */
export function isOverlayPath(path: EventTarget[]): boolean {
  return !!host && path.includes(host);
}

export function destroyOverlay(): void {
  host?.remove();
  host = null;
  root = null;
}
