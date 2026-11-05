/**
 * On-page launcher and deep links (SPEC: Discovery and hints). The launcher is a small "?"
 * button in the overlay, bottom right, listing the guides for this page; off by default and
 * turned on per site. A deep link (`waymark=<guideId>` in the query or hash) offers to start
 * that guide; it is read at document_start and removed with history.replaceState.
 */
import { send } from '../core/messaging/client';
import { overlayLayer, overlayRoot } from './overlay/host';
import { testMark } from './test-hooks';
import { CircleQuestionMark, MapPin, Play } from 'lucide';
import { buildSvg } from '../ui/svg';

const CSS = `
.wm-launch { position: fixed; right: 16px; bottom: 16px; width: 44px; height: 44px; border-radius: 50%; border: 2px solid var(--wm-surface);
  background: var(--wm-accent); color: var(--wm-accent-fg); display: grid; place-items: center; padding: 0; margin: 0; pointer-events: auto; cursor: pointer;
  box-shadow: var(--wm-shadow-2); box-sizing: border-box; }
.wm-launch:hover { background: var(--wm-accent-hover); }
.wm-launch svg { width: 22px; height: 22px; }
.wm-launch[aria-expanded='true'] { background: var(--wm-surface); color: var(--wm-fg); border-color: var(--wm-border); }
.wm-launch:focus-visible, .wm-card button:focus-visible { outline: 2px solid var(--wm-focus); outline-offset: 2px; }
.wm-card { position: fixed; right: 16px; bottom: 72px; width: max-content; min-width: 240px; max-width: min(340px, calc(100vw - 32px)); max-height: calc(100vh - 96px); overflow: auto;
  box-sizing: border-box; background: var(--wm-surface); color: var(--wm-fg); border: 1px solid var(--wm-border); border-radius: var(--wm-radius-lg);
  padding: 8px; pointer-events: auto; box-shadow: var(--wm-shadow-3); font: 14px/1.4 var(--wm-font); text-align: left; }
.wm-offer { bottom: 16px; padding: 14px 16px 12px; }
.wm-card h2 { font: 600 12px/1.4 var(--wm-font); letter-spacing: .04em; text-transform: uppercase; color: var(--wm-fg-muted); margin: 4px 8px 6px; }
.wm-offer h2 { margin: 0 0 6px; display: flex; align-items: center; gap: 6px; }
.wm-offer h2 svg { width: 14px; height: 14px; color: var(--wm-accent-text); }
.wm-card button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font: inherit; font-size: 14px; line-height: 20px; min-height: 36px;
  padding: 7px 10px; margin: 0; border: 0; border-radius: var(--wm-radius-sm); background: transparent; color: inherit; cursor: pointer; box-shadow: none; text-transform: none; }
.wm-card button:hover { background: var(--wm-surface-hover); }
.wm-card button svg { width: 16px; height: 16px; flex: none; color: var(--wm-accent-text); }
.wm-row { display: flex; gap: 6px; margin-top: 12px; justify-content: flex-end; }
.wm-row button { width: auto; padding: 5px 12px; min-height: 32px; font-size: 13px; font-weight: 500; }
.wm-card .wm-primary { background: var(--wm-accent); color: var(--wm-accent-fg); width: auto; }
.wm-card .wm-primary:hover { background: var(--wm-accent-hover); }
.wm-card .wm-primary svg { color: inherit; }
.wm-text { margin: 0; overflow-wrap: anywhere; }
.wm-note { font-size: 13px; color: var(--wm-fg-muted); margin: 8px; }
@media (prefers-reduced-motion: no-preference) {
  .wm-launch { transition: transform 120ms var(--wm-ease), background-color 120ms; animation: wm-pop 200ms var(--wm-ease); }
  .wm-launch:hover { transform: scale(1.06); }
  .wm-card { animation: wm-rise 160ms var(--wm-ease); }
}
@keyframes wm-pop { from { opacity: 0; scale: .6; } }
@keyframes wm-rise { from { opacity: 0; translate: 0 6px; } }
@media (forced-colors: active) { .wm-launch, .wm-card { border: 2px solid CanvasText; } }
`;

/** Reads and removes `waymark=<id>` from the URL (query or hash), keeping hash routes intact. */
export function takeDeepLink(loc: Location = location, hist: History = history): string | null {
  try {
    return takeDeepLinkUnsafe(loc, hist);
  } catch {
    return null; // e.g. malformed percent-encoding: ignore the link, never break the page
  }
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

function takeDeepLinkUnsafe(loc: Location, hist: History): string | null {
  const url = new URL(loc.href);
  let id: string | null = null;
  // Remove only the waymark=… segment and keep the rest of the query exactly as it was.
  const q = /([?&])waymark=([^&#]*)(&?)/.exec(url.search);
  if (q) {
    id = safeDecode(q[2] ?? '');
    url.search = url.search.replace(q[0], q[3] ? q[1]! : '').replace(/[?&]$/, '');
  } else if (url.hash.includes('waymark=')) {
    const m = /([#&?])waymark=([^&#]*)&?/.exec(url.hash);
    if (m) {
      id = safeDecode(m[2] ?? '');
      url.hash = url.hash.replace(m[0], m[1] === '#' ? '#' : m[1]!).replace(/[?&]$/, '');
      if (url.hash === '#') url.hash = '';
    }
  }
  if (!id || !/^[0-9A-Za-z_-]{1,64}$/.test(id)) return null;
  try {
    hist.replaceState(hist.state, '', url.href.replace(/#$/, ''));
  } catch {
    // some pages lock history; the offer still works
  }
  return id;
}

export function startLauncher(): { refresh(): void; offerDeepLink(id: string): void; dispose(): void } {
  if (window !== window.top) return { refresh() {}, offerDeepLink() {}, dispose() {} };
  let button: HTMLButtonElement | null = null;
  let menu: HTMLElement | null = null;
  let offer: HTMLElement | null = null;
  let guides: { id: string; title: string }[] = [];

  const ensureStyle = () => {
    const root = overlayRoot();
    if (!root.querySelector('style[data-launcher]')) {
      const st = document.createElement('style');
      st.dataset.launcher = '';
      st.textContent = CSS;
      root.append(st);
    }
  };

  // Focus goes back to the button when it was inside the menu, so it never drops to <body>.
  const onOutsidePress = (e: Event) => {
    const path = e.composedPath();
    if (menu && !path.includes(menu) && !(button && path.includes(button))) closeMenu(false);
  };
  const closeMenu = (refocus = !!menu && menu.contains(overlayRoot().activeElement)) => {
    document.removeEventListener('pointerdown', onOutsidePress, true);
    menu?.remove();
    menu = null;
    button?.setAttribute('aria-expanded', 'false');
    button?.removeAttribute('aria-controls');
    if (refocus) button?.focus();
  };

  const start = async (id: string, openStart = false, into: HTMLElement | null = null) => {
    try {
      const r = await send('launcher.start', { guideId: id, openStart });
      if (r.status === 'started') {
        closeMenu();
        offer?.remove();
        offer = null;
        return;
      }
      const host = into ?? menu ?? offer;
      if (!host) return;
      const note = document.createElement('div');
      note.className = 'wm-note';
      if (r.reachable) {
        note.textContent = 'This guide starts on another page.';
        const open = document.createElement('button');
        open.className = 'wm-primary';
        open.append(buildSvg(Play), 'Open start page');
        open.addEventListener('click', () => void start(id, true, host));
        host.append(note, open);
      } else {
        note.textContent = `This guide starts on a page like ${r.pattern}. Open that page, then press Start.`;
        host.append(note);
      }
    } catch {
      // not available here
    }
  };

  // A disclosure: the button shows a small panel of buttons, one per guide. Esc closes it and
  // returns focus to the button; Tab moves through the guides.
  const openMenu = () => {
    if (menu) return closeMenu(true);
    ensureStyle();
    menu = document.createElement('div');
    menu.className = 'wm-card wm-menu';
    menu.id = 'wm-launcher-menu';
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-labelledby', 'wm-launcher-title');
    const h = document.createElement('h2');
    h.id = 'wm-launcher-title';
    h.textContent = 'Guides for this page';
    menu.append(h);
    for (const g of guides) {
      const b = document.createElement('button');
      b.type = 'button';
      b.append(buildSvg(Play), g.title);
      b.dataset.guide = g.id;
      b.addEventListener('click', () => void start(g.id));
      menu.append(b);
    }
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenu(true);
      }
    });
    // Close when focus or a press goes elsewhere.
    menu.addEventListener('focusout', (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && !menu?.contains(to) && to !== button) closeMenu(false);
    });
    overlayLayer().append(menu);
    button?.setAttribute('aria-expanded', 'true');
    button?.setAttribute('aria-controls', menu.id);
    document.addEventListener('pointerdown', onOutsidePress, true);
    menu.querySelector('button')?.focus();
  };

  const render = (show: boolean) => {
    if (!show) {
      button?.remove();
      button = null;
      closeMenu();
      testMark('launcher', 'off');
      return;
    }
    ensureStyle();
    if (!button || !button.isConnected) {
      button = document.createElement('button');
      button.className = 'wm-launch';
      button.type = 'button';
      button.append(buildSvg(CircleQuestionMark));
      button.setAttribute('aria-label', 'Waymark guides for this page');
      button.title = 'Guides for this page';
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', () => openMenu());
      overlayLayer().append(button);
    }
    testMark('launcher', String(guides.length));
  };

  const refresh = () => {
    send('guide.forPage', { url: location.href })
      .then((r) => {
        guides = r.guides;
        closeMenu();
        render(r.launcher && guides.length > 0);
      })
      .catch(() => undefined);
  };

  const offerDeepLink = (id: string) => {
    send('deeplink.check', { guideId: id })
      .then((r) => {
        if (!r.guide) return;
        ensureStyle();
        offer?.remove();
        offer = document.createElement('div');
        offer.className = 'wm-card wm-offer';
        offer.setAttribute('role', 'dialog');
        offer.setAttribute('aria-labelledby', 'wm-offer-text');
        const h = document.createElement('h2');
        h.append(buildSvg(MapPin), 'Waymark guide');
        const t = document.createElement('p');
        t.className = 'wm-text';
        t.id = 'wm-offer-text';
        t.textContent = `Start the guide “${r.guide.title}”?`;
        const row = document.createElement('div');
        row.className = 'wm-row';
        const yes = document.createElement('button');
        yes.className = 'wm-primary';
        yes.append(buildSvg(Play), 'Start');
        yes.dataset.action = 'start';
        yes.addEventListener('click', () => void start(r.guide!.id, false, offer));
        const no = document.createElement('button');
        no.textContent = 'Not now';
        no.addEventListener('click', () => {
          offer?.remove();
          offer = null;
        });
        row.append(no, yes);
        offer.append(h, t, row);
        overlayLayer().append(offer);
        testMark('deeplink', r.guide.id);
      })
      .catch(() => undefined);
  };

  return {
    refresh,
    offerDeepLink,
    dispose() {
      render(false);
      offer?.remove();
    },
  };
}
