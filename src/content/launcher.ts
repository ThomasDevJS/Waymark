/**
 * On-page launcher and deep links (SPEC: Discovery and hints). The launcher is a small "?"
 * button in the overlay, bottom right, listing the guides for this page; off by default and
 * turned on per site. A deep link (`waymark=<guideId>` in the query or hash) offers to start
 * that guide; it is read at document_start and removed with history.replaceState.
 */
import { send } from '../core/messaging/client';
import { eventPath, overlayHost, overlayLayer, overlayRoot } from './overlay/host';
import { testMark } from './test-hooks';
import { dlog } from './debug';
import { CircleQuestionMark, MapPin, Play, Search } from 'lucide';
import { matchPageGuides, pageTagChips, showsPageSearch, type PageGuide } from '../core/discovery/page-search';
import { buildSvg } from '../ui/svg';

/** The launcher's styles (exported for the motion test, D134). */
export const LAUNCHER_CSS = `
.wm-launch { position: fixed; right: 16px; bottom: 16px; width: 44px; height: 44px; border-radius: 50%; border: 2px solid var(--wm-surface);
  background: var(--wm-accent); color: var(--wm-accent-fg); display: grid; place-items: center; padding: 0; margin: 0; pointer-events: auto; cursor: pointer;
  box-shadow: var(--wm-shadow-2); box-sizing: border-box; }
.wm-launch:hover { background: var(--wm-accent-hover); }
.wm-launch svg { width: 22px; height: 22px; }
.wm-launch[aria-expanded='true'] { background: var(--wm-surface); color: var(--wm-fg); border-color: var(--wm-border); }
.wm-launch:focus-visible, .wm-card button:focus-visible, .wm-search input:focus-visible { outline: 2px solid var(--wm-focus); outline-offset: 2px; }
.wm-card { position: fixed; right: 16px; bottom: 72px; width: max-content; min-width: 240px; max-width: min(340px, calc(100vw - 32px)); max-height: calc(100vh - 96px); overflow: auto;
  box-sizing: border-box; background: var(--wm-surface); color: var(--wm-fg); border: 1px solid var(--wm-border); border-radius: var(--wm-radius-lg);
  padding: 8px; pointer-events: auto; box-shadow: var(--wm-shadow-3); font: 14px/1.4 var(--wm-font); text-align: left; }
.wm-offer { bottom: 72px; padding: 14px 16px 12px; }
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
/* Search among many guides (D170): a box, up to three tag chips, and a list the arrow keys move through. */
.wm-search { position: relative; margin: 0 2px 6px; }
.wm-search svg { position: absolute; left: 9px; top: 50%; translate: 0 -50%; width: 16px; height: 16px; color: var(--wm-fg-muted); pointer-events: none; }
.wm-search input { box-sizing: border-box; width: 100%; min-height: 36px; margin: 0; padding: 7px 10px 7px 32px; font: inherit; font-size: 14px; color: var(--wm-fg);
  background: var(--wm-surface); border: 1px solid var(--wm-border); border-radius: var(--wm-radius-sm); box-shadow: none; }
.wm-search input::placeholder { color: var(--wm-fg-muted); opacity: 1; }
.wm-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 2px 6px; }
.wm-card .wm-chip { width: auto; min-height: 28px; padding: 3px 10px; font-size: 13px; line-height: 20px; border: 1px solid var(--wm-border); border-radius: 999px; }
.wm-card .wm-chip[aria-pressed='true'] { background: var(--wm-accent); color: var(--wm-accent-fg); border-color: var(--wm-accent); }
.wm-list { max-height: min(260px, calc(100vh - 240px)); overflow: auto; }
.wm-option { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 7px 10px; box-sizing: border-box; border-radius: var(--wm-radius-sm); cursor: pointer; overflow-wrap: anywhere; }
.wm-option:hover { background: var(--wm-surface-hover); }
.wm-option[aria-selected='true'] { background: var(--wm-surface-hover); outline: 2px solid var(--wm-focus); outline-offset: -2px; }
.wm-option svg { width: 16px; height: 16px; flex: none; color: var(--wm-accent-text); }
.wm-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.wm-note { font-size: 13px; color: var(--wm-fg-muted); margin: 8px; }
/* Motion (D130, D134): transform and opacity only, and nothing moves under reduced motion. The
   button pops in with a small spring, grows a little on hover and squeezes when pressed; the
   menu and the deep-link offer rise in; rows and buttons press like the panel's (D131). */
.wm-launch:active, .wm-card button:active { box-shadow: inset 0 1px 2px rgba(16, 24, 40, .18); }
@media (prefers-reduced-motion: no-preference) {
  .wm-launch { transition: transform var(--wm-dur-fast) var(--wm-ease-spring), background-color var(--wm-dur-fast) var(--wm-ease-standard), border-color var(--wm-dur-fast) var(--wm-ease-standard);
    animation: wm-launch-pop var(--wm-dur-slow) var(--wm-ease-spring); }
  .wm-launch:hover { transform: scale(1.06); }
  .wm-launch:active { transform: scale(.92); transition-duration: var(--wm-dur-press); }
  .wm-card { animation: wm-launch-rise var(--wm-dur-base) var(--wm-ease-enter); }
  .wm-option { transition: background-color var(--wm-dur-fast) var(--wm-ease-standard); }
  .wm-card button { transition: background-color var(--wm-dur-fast) var(--wm-ease-standard), transform var(--wm-dur-fast) var(--wm-ease-spring); }
  .wm-card button:active { transform: scale(var(--wm-press-lg)); transition-duration: var(--wm-dur-press); }
  .wm-row button:active, .wm-card .wm-primary:active { transform: scale(var(--wm-press)); }
  .wm-launch:focus-visible, .wm-card button:focus-visible { animation: wm-launch-focus-in var(--wm-dur-fast) var(--wm-ease-enter); }
}
@keyframes wm-launch-pop { from { opacity: 0; scale: .6; } }
@keyframes wm-launch-rise { from { opacity: 0; translate: 0 var(--wm-move-lg); } }
@keyframes wm-launch-focus-in { from { outline-offset: 5px; outline-color: transparent; } }
@media (forced-colors: active) {
  .wm-launch, .wm-card { border: 2px solid CanvasText; }
  .wm-option[aria-selected='true'] { outline-color: Highlight; }
  .wm-card .wm-chip[aria-pressed='true'] { border-width: 3px; }
}
`;

/** Reads and removes `waymark=<id>` from the URL (query or hash), keeping hash routes intact. */
export function takeDeepLink(loc: Location = location, hist: History = history): string | null {
  return takeDeepLinkWithStep(loc, hist)?.id ?? null;
}

/** A deep link, and the step a broken-step report points at (1-based, D212), if any. */
export interface DeepLink {
  id: string;
  step: number | null;
}

/** The step number of a report link: an integer from 1 to MAX_LINK_STEP; anything else is ignored (D212). */
export const MAX_LINK_STEP = 1000;

/**
 * Reads and removes `waymark=<id>` and `waymark-step=<N>` from the URL (query or hash), keeping
 * the rest exactly as it was. A malformed step number is removed too and ignored: the link
 * behaves like a plain deep link (D212).
 */
export function takeDeepLinkWithStep(loc: Location = location, hist: History = history): DeepLink | null {
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

/** Removes one `name=value` segment from a query (`?a&b`) or a hash (`#…`), keeping the rest exactly. */
function cut(part: string, name: string, hash: boolean): { value: string | null; rest: string } {
  const re = hash ? new RegExp(`([#&?])${name}=([^&#]*)&?`) : new RegExp(`([?&])${name}=([^&#]*)(&?)`);
  const m = re.exec(part);
  if (!m) return { value: null, rest: part };
  const value = safeDecode(m[2] ?? '');
  let rest: string;
  if (hash) {
    rest = part.replace(m[0], m[1] === '#' ? '#' : m[1]!).replace(/[?&]$/, '');
    if (rest === '#') rest = '';
  } else {
    rest = part.replace(m[0], m[3] ? m[1]! : '').replace(/[?&]$/, '');
  }
  return { value, rest };
}

function takeDeepLinkUnsafe(loc: Location, hist: History): DeepLink | null {
  const url = new URL(loc.href);
  let id: string | null = null;
  let step: string | null = null;
  let changed = false;
  if (/[?&]waymark(-step)?=/.test(url.search)) {
    const a = cut(url.search, 'waymark', false);
    const b = cut(a.rest, 'waymark-step', false);
    id = a.value;
    step = b.value;
    url.search = b.rest;
    changed = true;
  } else if (/[#&?]waymark(-step)?=/.test(url.hash)) {
    const a = cut(url.hash, 'waymark', true);
    const b = cut(a.rest, 'waymark-step', true);
    id = a.value;
    step = b.value;
    url.hash = b.rest;
    changed = true;
  }
  if (!changed || !id || !/^[0-9A-Za-z_-]{1,64}$/.test(id)) return null;
  try {
    hist.replaceState(hist.state, '', url.href.replace(/#$/, ''));
  } catch {
    // some pages lock history; the offer still works
  }
  const n = step !== null && /^[1-9][0-9]{0,3}$/.test(step) ? Number(step) : null;
  return { id, step: n !== null && n <= MAX_LINK_STEP ? n : null };
}

/**
 * True when a press is on the launcher or its menu, or anywhere in Waymark's overlay. In production
 * the overlay's shadow root is closed, so a document listener sees a press inside it only as a
 * press on the overlay host, never on the menu (#42). Test builds use an open root and hid this.
 */
export function pressInsideLauncher(path: EventTarget[], menu: Element | null, button: Element | null, host: Element | null): boolean {
  return (!!menu && path.includes(menu)) || (!!button && path.includes(button)) || (!!host && path.includes(host));
}

/** `isTop`: only the top frame shows the launcher (a parameter so browser tests, run in an iframe, can say yes). */
export function startLauncher(isTop = window === window.top): { refresh(): void; offerDeepLink(link: DeepLink | string): void; dispose(): void } {
  if (!isTop) return { refresh() {}, offerDeepLink() {}, dispose() {} };
  let button: HTMLButtonElement | null = null;
  let menu: HTMLElement | null = null;
  let offer: HTMLElement | null = null;
  let guides: PageGuide[] = [];
  /** The menu's search, when the page has many guides (D170). */
  let search: { clear(): boolean; input: HTMLInputElement } | null = null;

  const ensureStyle = () => {
    const root = overlayRoot();
    if (!root.querySelector('style[data-launcher]')) {
      const st = document.createElement('style');
      st.dataset.launcher = '';
      st.textContent = LAUNCHER_CSS;
      root.append(st);
    }
  };

  // Focus goes back to the button when it was inside the menu, so it never drops to <body>.
  const onOutsidePress = (e: Event) => {
    if (menu && !pressInsideLauncher(eventPath(e), menu, button, overlayHost())) closeMenu(false);
  };
  const closeMenu = (refocus = !!menu && menu.contains(overlayRoot().activeElement)) => {
    document.removeEventListener('pointerdown', onOutsidePress, true);
    menu?.remove();
    menu = null;
    search = null;
    testMark('launcher-menu', 'closed');
    button?.setAttribute('aria-expanded', 'false');
    button?.removeAttribute('aria-controls');
    if (refocus) button?.focus();
  };

  /** The place for the note after a start that didn't happen; it replaces an earlier note. */
  const startNote = (host: HTMLElement): HTMLElement => {
    host.querySelector(':scope > .wm-start-note')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'wm-start-note';
    host.append(wrap);
    return wrap;
  };

  /** Starts a guide; from a report link at step `stepIndex`, and with `fix`, with the player's pick open there (D212). */
  const start = async (id: string, openStart = false, into: HTMLElement | null = null, from: { stepIndex: number; fix?: boolean } | null = null) => {
    try {
      const r = from?.fix && !openStart ? await send('launcher.fix', { guideId: id, stepIndex: from.stepIndex }) : await send('launcher.start', { guideId: id, openStart, ...(from ? { stepIndex: from.stepIndex } : {}) });
      if (r.status === 'started') {
        closeMenu();
        offer?.remove();
        offer = null;
        return;
      }
      const host = into ?? menu ?? offer;
      if (!host) return;
      // One note at a time, announced: with the search, focus stays in the box (D170 review).
      const wrap = startNote(host);
      const note = document.createElement('div');
      note.className = 'wm-note';
      note.setAttribute('role', 'status');
      if (r.reachable) {
        note.textContent = 'This guide starts on another page.';
        const open = document.createElement('button');
        open.className = 'wm-primary';
        open.append(buildSvg(Play), 'Open start page');
        // The step's page opens and the run starts there; a fix starts from its tooltip or card.
        open.addEventListener('click', () => void start(id, true, host, from ? { stepIndex: from.stepIndex } : null));
        wrap.append(note, open);
      } else {
        note.textContent = `This guide starts on a page like ${r.pattern}. Open that page, then press Start.`;
        wrap.append(note);
      }
    } catch (e) {
      // Never fail silently (#42): the menu stays and says so.
      dlog('play', 'launcher.failed', () => ({ why: e instanceof Error ? e.message : String(e) }));
      const host = into ?? menu ?? offer;
      if (host) {
        const note = document.createElement('div');
        note.className = 'wm-note';
        note.setAttribute('role', 'alert');
        note.textContent = e instanceof Error && e.message ? `Couldn’t start this guide: ${e.message}` : 'Couldn’t start this guide here.';
        startNote(host).append(note);
      }
      testMark('launcher-error', '1');
    }
  };

  /**
   * The menu's search (D170): a combobox whose list the arrow keys move through while focus stays
   * in the box, so typing goes on filtering. Enter starts the selected guide. Matching runs here,
   * over the titles and tags `guide.forPage` sent for this origin only (D171).
   */
  const searchList = (m: HTMLElement): { clear(): boolean; input: HTMLInputElement } => {
    let query = '';
    let picked: string[] = [];
    let shown: PageGuide[] = guides;
    let active = -1;
    const box = document.createElement('div');
    box.className = 'wm-search';
    const input = document.createElement('input');
    input.type = 'search';
    input.id = 'wm-launcher-q';
    input.placeholder = 'Search guides';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', 'Search the guides for this page');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'wm-launcher-list');
    box.append(buildSvg(Search), input);
    m.append(box);

    const chipTags = pageTagChips(guides);
    const chips: HTMLButtonElement[] = [];
    if (chipTags.length) {
      const row = document.createElement('div');
      row.className = 'wm-chips';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Filter by tag');
      for (const tag of chipTags) {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'wm-chip';
        c.textContent = tag;
        c.dataset.tag = tag;
        c.setAttribute('aria-pressed', 'false');
        c.addEventListener('click', () => {
          picked = picked.includes(tag) ? picked.filter((t) => t !== tag) : [...picked, tag];
          c.setAttribute('aria-pressed', String(picked.includes(tag)));
          draw(true);
        });
        chips.push(c);
        row.append(c);
      }
      m.append(row);
    }

    const list = document.createElement('div');
    list.className = 'wm-list';
    list.id = 'wm-launcher-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', 'wm-launcher-title');
    // Never a Tab stop of its own, even once it scrolls (Chromium makes scrollers focusable).
    list.tabIndex = -1;
    list.addEventListener('mousedown', (e) => e.preventDefault());
    const status = document.createElement('div');
    status.className = 'wm-note';
    status.setAttribute('role', 'status');
    m.append(list, status);

    const setActive = (i: number) => {
      active = i;
      list.querySelectorAll<HTMLElement>('[role=option]').forEach((o, j) => o.setAttribute('aria-selected', String(j === i)));
      const opt = i >= 0 ? list.querySelector<HTMLElement>(`#wm-launcher-opt-${i}`) : null;
      if (opt) {
        input.setAttribute('aria-activedescendant', opt.id);
        opt.scrollIntoView?.({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
      if (__WAYMARK_TEST__) testMark('launcher-active', shown[i]?.id ?? '');
    };

    // `filtered`: the query or the chips changed. Then the best match is selected, so Enter starts it.
    const draw = (filtered: boolean) => {
      shown = matchPageGuides(guides, query, picked);
      const opts = shown.map((g, i) => {
        const o = document.createElement('div');
        o.className = 'wm-option';
        o.id = `wm-launcher-opt-${i}`;
        o.setAttribute('role', 'option');
        o.dataset.guide = g.id;
        o.append(buildSvg(Play), g.title);
        // Keep focus in the box when an option is pressed.
        o.addEventListener('mousedown', (e) => e.preventDefault());
        o.addEventListener('click', () => void start(g.id));
        return o;
      });
      list.replaceChildren(...opts);
      list.hidden = shown.length === 0;
      input.setAttribute('aria-expanded', String(!list.hidden));
      const filtering = !!query.trim() || picked.length > 0;
      // A note about an earlier guide no longer applies once the list changes.
      if (filtered) m.querySelector(':scope > .wm-start-note')?.remove();
      status.textContent = shown.length === 0 ? 'No guides match' : filtering ? `${shown.length} of ${guides.length} guides` : '';
      status.classList.toggle('wm-sr', shown.length > 0);
      // A changed filter selects its best match, or nothing once it is cleared: never a guide
      // that only happens to sit where the selection was (review).
      setActive(filtered ? (filtering && shown.length ? 0 : -1) : Math.min(active, shown.length - 1));
      if (__WAYMARK_TEST__) testMark('launcher-results', shown.map((g) => g.id).join(','));
    };

    input.addEventListener('input', () => {
      query = input.value;
      draw(true);
    });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return; // Enter confirms an IME candidate, not a guide
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!shown.length) return;
        setActive(e.key === 'ArrowDown' ? Math.min(active + 1, shown.length - 1) : Math.max(active - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const g = shown[active];
        if (g) void start(g.id);
      }
    });
    // Keys typed here are Waymark's: the page's own shortcuts (on document or window, which see
    // only the overlay host in a closed root) must not fire while someone types a search.
    for (const type of ['keydown', 'keyup', 'keypress', 'beforeinput', 'input']) m.addEventListener(type, (e) => e.stopPropagation());
    draw(false);
    return {
      input,
      clear() {
        if (!query && !picked.length) return false;
        query = input.value = '';
        picked = [];
        for (const c of chips) c.setAttribute('aria-pressed', 'false');
        draw(false);
        setActive(-1);
        return true;
      },
    };
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
    if (showsPageSearch(guides.length)) {
      search = searchList(menu);
    } else {
      for (const g of guides) {
        const b = document.createElement('button');
        b.type = 'button';
        b.append(buildSvg(Play), g.title);
        b.dataset.guide = g.id;
        b.addEventListener('click', () => void start(g.id));
        menu.append(b);
      }
    }
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (e.isComposing) return; // Esc cancels the IME composition first
        e.preventDefault();
        // With a search: the first Esc clears it, the next one closes (D170).
        if (search?.clear()) search.input.focus();
        else closeMenu(true);
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
    testMark('launcher-menu', search ? 'search' : 'list');
    if (search) search.input.focus();
    else menu.querySelector('button')?.focus();
    if (__WAYMARK_TEST__) {
      // With a closed root (production) tests cannot query inside: they click where the first guide is.
      const r = menu.querySelector('[data-guide]')?.getBoundingClientRect();
      if (r) testMark('launcher-item', `${Math.round(r.left + r.width / 2)},${Math.round(r.top + r.height / 2)}`);
    }
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
        // A route report that changes nothing keeps an open menu and what was typed in it (review).
        if (menu && JSON.stringify(r.guides) === JSON.stringify(guides)) return render(r.launcher && guides.length > 0);
        guides = r.guides;
        closeMenu();
        render(r.launcher && guides.length > 0);
      })
      .catch(() => undefined);
  };

  /** A plain deep link offers Start; a broken-step report link (D212) offers Fix or Start from step N. */
  const offerDeepLink = (link: DeepLink | string) => {
    const { id, step } = typeof link === 'string' ? { id: link, step: null } : link;
    send('deeplink.check', { guideId: id, ...(step !== null ? { step } : {}) })
      .then((r) => {
        if (!r.guide && !r.notInLibrary) return;
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
        const row = document.createElement('div');
        row.className = 'wm-row';
        const no = document.createElement('button');
        no.textContent = r.guide ? 'Not now' : 'Close';
        no.dataset.action = 'not-now';
        no.addEventListener('click', () => {
          offer?.remove();
          offer = null;
        });
        row.append(no);
        const yes = (label: string, action: string, run: () => void) => {
          const b = document.createElement('button');
          b.className = 'wm-primary';
          b.append(buildSvg(Play), label);
          b.dataset.action = action;
          b.addEventListener('click', run);
          row.append(b);
        };
        const g = r.guide;
        const n = (r.stepIndex ?? 0) + 1;
        if (!g) {
          t.textContent = 'This guide isn’t in your library.';
        } else if (r.offer === 'fix') {
          t.textContent = `Fix step ${n} of “${g.title}”? The guide starts at that step; then click the right element.`;
          yes(`Fix step ${n}`, 'fix', () => void start(g.id, false, offer, { stepIndex: n - 1, fix: true }));
        } else if (r.offer === 'start') {
          t.textContent = `Start “${g.title}” from step ${n}?`;
          yes(`Start from step ${n}`, 'start', () => void start(g.id, false, offer, { stepIndex: n - 1 }));
        } else if (r.offer === 'no-step') {
          t.textContent = `That step no longer exists in your copy of “${g.title}”.`;
          yes('Start from step 1', 'start', () => void start(g.id, false, offer));
        } else {
          t.textContent = `Start the guide “${g.title}”?`;
          yes('Start', 'start', () => void start(g.id, false, offer));
        }
        offer.append(h, t, row);
        overlayLayer().append(offer);
        testMark('deeplink', g?.id ?? 'not-in-library');
        testMark('deeplink-offer', g ? (r.offer ?? 'plain') : 'not-in-library');
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
