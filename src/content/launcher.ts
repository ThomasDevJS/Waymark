/**
 * On-page launcher and deep links (SPEC: Discovery and hints). The launcher is a small "?"
 * button in the overlay, bottom right, listing the guides for this page; off by default and
 * turned on per site. A deep link (`waymark=<guideId>` in the query or hash) offers to start
 * that guide; it is read at document_start and removed with history.replaceState.
 */
import { send } from '../core/messaging/client';
import { overlayLayer, overlayRoot } from './overlay/host';
import { testMark } from './test-hooks';

const CSS = `
.wm-launch { position: fixed; right: 16px; bottom: 16px; width: 36px; height: 36px; border-radius: 50%; border: 0; background: #2f5fd0; color: #fff;
  font: 600 18px/36px system-ui, sans-serif; pointer-events: auto; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.3); padding: 0; }
.wm-menu, .wm-offer { position: fixed; right: 16px; bottom: 60px; min-width: 220px; max-width: min(340px, calc(100vw - 32px)); background: #fff; color: #1d1f23;
  border: 1px solid #d9dde3; border-radius: 10px; padding: 8px; pointer-events: auto; box-shadow: 0 6px 24px rgba(0,0,0,.25); font: 14px/1.4 system-ui, sans-serif; }
.wm-offer { bottom: 16px; }
.wm-menu h2, .wm-offer h2 { font-size: 12px; font-weight: 600; color: #5f6672; margin: 2px 4px 6px; }
.wm-menu button, .wm-offer button { display: block; width: 100%; text-align: left; font: inherit; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
.wm-menu button:hover, .wm-offer button:hover, .wm-menu button:focus-visible { background: #eef2fb; outline: none; }
.wm-row { display: flex; gap: 6px; } .wm-row button { width: auto; } .wm-primary { background: #2f5fd0 !important; color: #fff !important; }
.wm-note { font-size: 12px; color: #5f6672; margin: 4px; }
@media (prefers-color-scheme: dark) { .wm-menu, .wm-offer { background: #23262c; color: #e8eaed; border-color: #3a3e45; } .wm-menu button:hover { background: #2f3440; } }
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

  const closeMenu = () => {
    menu?.remove();
    menu = null;
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
        open.textContent = 'Open start page';
        open.addEventListener('click', () => void start(id, true, host));
        host.append(note, open);
      } else {
        note.textContent = `This guide starts on a page like ${r.pattern}. Open that page, then start it.`;
        host.append(note);
      }
    } catch {
      // not available here
    }
  };

  const openMenu = () => {
    if (menu) return closeMenu();
    ensureStyle();
    menu = document.createElement('div');
    menu.className = 'wm-menu';
    menu.setAttribute('role', 'menu');
    const h = document.createElement('h2');
    h.textContent = 'Guides for this page';
    menu.append(h);
    for (const g of guides) {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.textContent = g.title;
      b.dataset.guide = g.id;
      b.addEventListener('click', () => void start(g.id));
      menu.append(b);
    }
    overlayLayer().append(menu);
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
      button.textContent = '?';
      button.setAttribute('aria-label', 'Waymark guides for this page');
      button.addEventListener('click', openMenu);
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
        offer.className = 'wm-offer';
        offer.setAttribute('role', 'dialog');
        offer.setAttribute('aria-label', 'Start a Waymark guide');
        const h = document.createElement('h2');
        h.textContent = 'Waymark';
        const t = document.createElement('div');
        t.textContent = `Start the guide “${r.guide.title}”?`;
        const row = document.createElement('div');
        row.className = 'wm-row';
        const yes = document.createElement('button');
        yes.className = 'wm-primary';
        yes.textContent = 'Start';
        yes.dataset.action = 'start';
        yes.addEventListener('click', () => void start(r.guide!.id, false, offer));
        const no = document.createElement('button');
        no.textContent = 'Not now';
        no.addEventListener('click', () => {
          offer?.remove();
          offer = null;
        });
        row.append(yes, no);
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
