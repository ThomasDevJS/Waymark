/**
 * Service worker: the hub. Keeps no state in memory (the browser stops it after 30 s idle);
 * everything lives in chrome.storage. Routes every message, owns storage and registrations.
 */
import { createRouter, type Handlers } from '../core/messaging/router';
import { injectIntoOpenTabs, syncRegistrations, grantedSitePatterns } from '../core/permissions/registration';
import { claimNonce, framePathFor, framesKey, issueNonce, noncesKey, type FrameMap } from '../core/frames/registry';
import { sessionKV } from '../core/storage/session-kv';
import { enqueue } from '../core/storage/queue';
import { originToMatchPattern } from '../core/url/url';
import { listGuides } from '../core/storage/guides';
import { onRouteReport, onSitesRevoked, onTabCreated, onTabRemoved, recordingHandlers } from '../background/recording';
import { editorHandlers, endPick } from '../background/editor';
import { discoveryHandlers, LIBRARY_ALARM, migrateLibraryFetchOnly, onBrowserStartLibrary, refreshLibrary, updateAllBadges, updateBadge } from '../background/discovery';
import { fetchOnlyPatterns, setFetchOnly, siteAllowed } from '../background/site-access';
import { isSiteOrigin } from '../core/model/schema';
import { rebuildIndex } from '../core/storage/guides';
import { setupPanelFallback } from '../background/panel-fallback';
import { getVoiceSettings, listVoices, setVoiceSettings, speakHdSample, speakSample } from '../background/voice';
import { HD_IDLE_ALARM, hdEnable, hdRemove, hdStatusForSettings, onHdIdle, onHdReport } from '../background/hd';
import { carryRunToNewTab, dropRun, resumeRunsMovedTo, endRunsOnRevokedSites, onRunCommand, onTopFrameLoad, runHandlers, viewFor } from '../background/runs';

const sync = () => enqueue(async () => syncRegistrations(chrome, await fetchOnlyPatterns()));

async function tabInfo(windowId?: number, tabId?: number) {
  const query: chrome.tabs.QueryInfo = windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId };
  const tab = tabId !== undefined ? await chrome.tabs.get(tabId).catch(() => undefined) : (await chrome.tabs.query(query))[0];
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
        granted = await siteAllowed(origin);
      }
    } catch {
      // not a URL we handle
    }
  }
  return { tabId: tab?.id ?? null, url, origin, grantable, granted };
}

const handlers: Handlers = {
  ...recordingHandlers,
  ...runHandlers,
  ...editorHandlers,
  ...discoveryHandlers,
  'guide.list': async () => ({ guides: await listGuides() }),
  'voice.list': () => listVoices(),
  'voice.test': async ({ lang }) => ({ ok: await speakSample(lang) }),
  'voice.settings.get': () => getVoiceSettings(),
  'voice.settings.set': ({ patch }) => setVoiceSettings(patch),
  'hd.status': () => hdStatusForSettings(),
  'hd.enable': ({ added }) => hdEnable(added),
  'hd.remove': () => hdRemove(),
  'hd.test': async () => ({ ok: await speakHdSample() }),
  'hd.report': async (payload, ctx) => {
    // Only the offscreen document reports; other extension pages may not.
    if (ctx.sender.url !== chrome.runtime.getURL('/offscreen.html')) throw new Error('hd.report is for the offscreen document');
    await onHdReport(payload);
    return { ok: true as const };
  },
  'tab.current': ({ windowId, tabId }) => tabInfo(windowId, tabId),
  'site.list': async () => {
    const { origins = [] } = await chrome.permissions.getAll();
    const regs = await chrome.scripting.getRegisteredContentScripts();
    return { origins: grantedSitePatterns(origins), registered: regs.flatMap((r) => r.matches ?? []) };
  },
  'site.sync': async () => ({ registered: await sync() }),
  // The user allowed these sites (panel). A library site granted only for fetching becomes a
  // guide site now: no permission event fires for it, so register and inject here (D80).
  'site.allowed': async ({ origins }) => {
    const marked = await fetchOnlyPatterns();
    // Only sites that were fetch-only: a fresh grant is already handled by permissions.onAdded,
    // and injecting twice would restart the content script in open tabs.
    const sites = origins.filter((o) => isSiteOrigin(o) && marked.includes(originToMatchPattern(o)));
    for (const o of sites) await setFetchOnly(o, false);
    const registered = await sync();
    if (sites.length) await injectIntoOpenTabs(sites.map(originToMatchPattern).filter((p) => registered.includes(p)));
    return { registered };
  },
  'route.report': async (payload, ctx) => {
    if (__WAYMARK_TEST__ && ctx.tabId !== undefined && ctx.frameId === 0 && payload.via !== 'leaving') {
      await chrome.storage.session.set({ [`test:route:${ctx.tabId}`]: payload.url });
    }
    const recording = await onRouteReport(payload, ctx);
    // In-app route changes update the badge count (SPEC: Discovery, toolbar badge).
    if (ctx.frameId === 0 && ctx.tabId !== undefined && payload.via !== 'leaving') await updateBadge(ctx.tabId, ctx.sender.tab?.url ?? payload.url);
    if (payload.via === 'load' && ctx.frameId === 0 && ctx.tabId !== undefined) {
      await onTopFrameLoad(ctx.tabId, payload.url);
      // A new page has no picker running: end a pending pick so the panel stops waiting.
      if ((await chrome.storage.session.get(`pick:${ctx.tabId}`))[`pick:${ctx.tabId}`]) await endPick(ctx.tabId, true);
    }
    return { ok: true as const, recording, run: await viewFor(ctx.tabId, ctx.sender.tab?.url) };
  },
  'frame.nonce': async ({ selector }, ctx) => {
    if (ctx.tabId === undefined || ctx.frameId === undefined) throw new Error('no frame');
    const tabId = ctx.tabId;
    const frameId = ctx.frameId;
    return { nonce: await enqueue(() => issueNonce(sessionKV, tabId, frameId, selector)) };
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
  setupPanelFallback(chrome as unknown as Parameters<typeof setupPanelFallback>[0]);

  // Open the side panel from the toolbar click. sidePanel.open must run before any await,
  // while the user gesture is still valid; the click also grants activeTab for this tab.
  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId !== undefined) void chrome.sidePanel?.open({ windowId: tab.windowId });
  });

  chrome.runtime.onMessage.addListener(createRouter(handlers, chrome.runtime.id));

  // Content scripts get data only through the service worker (SPEC: Data model, Storage).
  void chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);
  void (chrome.storage.local as chrome.storage.StorageArea).setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);

  chrome.runtime.onInstalled.addListener(async (details) => {
    await rebuildIndex();
    // Subscribed before fetch-only marks existed: mark the library site now (D80).
    if (details.reason === 'update') await migrateLibraryFetchOnly();
    await onBrowserStartLibrary();
    const patterns = await sync();
    // After install or update, already-open tabs of granted sites get the new script.
    await injectIntoOpenTabs(patterns);
  });
  chrome.runtime.onStartup.addListener(() => {
    void sync();
    void onBrowserStartLibrary();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === LIBRARY_ALARM) void refreshLibrary();
    if (alarm.name === HD_IDLE_ALARM) void onHdIdle();
  });
  // The badge learns the URL from tabs.onUpdated (readable on granted sites) and route reports.
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.url || info.status === 'complete') void updateBadge(tabId, tab.url);
  });

  chrome.permissions.onAdded.addListener(async (added) => {
    await sync();
    await injectIntoOpenTabs(grantedSitePatterns(added.origins ?? [], await fetchOnlyPatterns()));
  });
  chrome.permissions.onRemoved.addListener(() => {
    void sync();
    void onSitesRevoked();
    void endRunsOnRevokedSites();
    void updateAllBadges();
  });

  chrome.tabs.onCreated.addListener((tab) => {
    void onTabCreated(tab);
    void carryRunToNewTab(tab);
  });
  chrome.commands?.onCommand.addListener((command, tab) => void onRunCommand(command, tab));
  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.storage.session.remove([framesKey(tabId), noncesKey(tabId), `test:route:${tabId}`]);
    void onTabRemoved(tabId);
    void resumeRunsMovedTo(tabId).then(() => dropRun(tabId));
  });
});
