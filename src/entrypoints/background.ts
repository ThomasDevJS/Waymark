/**
 * Service worker: the hub. Keeps no state in memory (the browser stops it after 30 s idle);
 * everything lives in chrome.storage. Routes every message, owns storage and registrations.
 */
import { createRouter, type Handlers } from '../core/messaging/router';
import { injectIntoOpenTabs, syncRegistrations, grantedSitePatterns } from '../core/permissions/registration';
import { claimNonce, framePathFor, framesKey, issueNonce, type FrameMap } from '../core/frames/registry';
import { sessionKV } from '../core/storage/session-kv';
import { enqueue } from '../core/storage/queue';
import { originToMatchPattern } from '../core/url/url';

const sync = () => enqueue(() => syncRegistrations(chrome));

async function tabInfo(windowId?: number) {
  const query: chrome.tabs.QueryInfo = windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId };
  const [tab] = await chrome.tabs.query(query);
  const url = tab?.url ?? null; // readable after the toolbar click (activeTab) or on granted sites
  let origin: string | null = null;
  let grantable = false;
  let granted = false;
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        origin = u.origin;
        grantable = true;
        granted = await chrome.permissions.contains({ origins: [originToMatchPattern(origin)] });
      }
    } catch {
      // not a URL we handle
    }
  }
  return { tabId: tab?.id ?? null, url, origin, grantable, granted };
}

const handlers: Handlers = {
  'tab.current': ({ windowId }) => tabInfo(windowId),
  'site.list': async () => {
    const { origins = [] } = await chrome.permissions.getAll();
    const regs = await chrome.scripting.getRegisteredContentScripts();
    return { origins: grantedSitePatterns(origins), registered: regs.flatMap((r) => r.matches ?? []) };
  },
  'site.sync': async () => ({ registered: await sync() }),
  'route.report': async ({ url }, ctx) => {
    if (__WAYMARK_TEST__ && ctx.tabId !== undefined && ctx.frameId === 0) {
      await chrome.storage.session.set({ [`test:route:${ctx.tabId}`]: url });
    }
    return { ok: true as const };
  },
  // Guides arrive in M5; content scripts only ever get guides for their own origin.
  'guide.forPage': () => ({ guides: [] }),
  'frame.nonce': async ({ selector }, ctx) => {
    if (ctx.tabId === undefined || ctx.frameId === undefined) throw new Error('no frame');
    return { nonce: await issueNonce(sessionKV, ctx.tabId, ctx.frameId, selector) };
  },
  'frame.claim': async ({ nonce }, ctx) => {
    if (ctx.tabId === undefined || ctx.frameId === undefined) return { ok: false };
    const tabId = ctx.tabId;
    const frameId = ctx.frameId;
    return { ok: await enqueue(() => claimNonce(sessionKV, nonce, tabId, frameId)) };
  },
  'frame.path': async (_p, ctx) => {
    if (ctx.tabId === undefined || ctx.frameId === undefined) return { framePath: null };
    const map = (await sessionKV.get<FrameMap>(framesKey(ctx.tabId))) ?? {};
    return { framePath: framePathFor(map, ctx.frameId) };
  },
};

export default defineBackground(() => {
  // Open the side panel from the toolbar click. sidePanel.open must run before any await,
  // while the user gesture is still valid; the click also grants activeTab for this tab.
  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
  });

  chrome.runtime.onMessage.addListener(createRouter(handlers, chrome.runtime.id));

  // Content scripts get data only through the service worker (SPEC: Data model, Storage).
  void chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);
  void (chrome.storage.local as chrome.storage.StorageArea).setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);

  chrome.runtime.onInstalled.addListener(async () => {
    const patterns = await sync();
    // After install or update, already-open tabs of granted sites get the new script.
    await injectIntoOpenTabs(patterns);
  });
  chrome.runtime.onStartup.addListener(() => void sync());

  chrome.permissions.onAdded.addListener(async (added) => {
    await sync();
    await injectIntoOpenTabs(grantedSitePatterns(added.origins ?? []));
  });
  chrome.permissions.onRemoved.addListener(() => void sync());

  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.storage.session.remove([framesKey(tabId), `test:route:${tabId}`]);
  });
});
