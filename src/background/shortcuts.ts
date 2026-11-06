/**
 * Keyboard shortcuts beyond the player's (D105): `toggle-recording` starts recording in the tab
 * the shortcut was pressed in, or stops the running recording. The side panel opens too, since
 * it shows the live steps and, after Stop, the editor. `_execute_action` (open the side panel)
 * is the toolbar button's own command and needs no code: it fires action.onClicked.
 *
 * Starting and stopping go through the same handlers as the panel's Record and Stop buttons, so
 * the same checks apply (an allowed http(s) site, one recording at a time).
 */
import type { HandlerContext } from '../core/messaging/router';
import { getRecording, recordingHandlers } from './recording';
import { SHORTCUT_KEY, type ShortcutOutcome } from '../core/storage/shortcut';

export const TOGGLE_RECORDING = 'toggle-recording';

const ctx = { kind: 'extension' } as unknown as HandlerContext;

/**
 * Opens the side panel for the window. Must run before any await, while the key press still
 * counts as a user gesture; browsers without a side panel use the popup, which a command
 * cannot open, so they rely on the toolbar badge and the REC pill instead.
 */
export function openPanelNow(tab: chrome.tabs.Tab | undefined): void {
  if (tab?.windowId === undefined || typeof chrome.sidePanel?.open !== 'function') return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
}

/**
 * Presses are handled one after another, so a quick double press is start-then-stop, never two
 * starts (the second of which would report "already running" while a recording runs). Like the
 * write queue, this chain holds no state, only order.
 */
let tail: Promise<unknown> = Promise.resolve();

export function toggleRecording(tab: chrome.tabs.Tab | undefined, now = Date.now): Promise<ShortcutOutcome> {
  const run = tail.then(() => toggleNow(tab, now));
  tail = run.catch(() => undefined);
  return run;
}

async function toggleNow(tab: chrome.tabs.Tab | undefined, now: () => number): Promise<ShortcutOutcome> {
  let out: ShortcutOutcome;
  try {
    if (await getRecording()) {
      const r = await recordingHandlers['rec.stop']!({}, ctx);
      out = r ? { kind: 'stopped', guideId: r.guideId, title: r.title, count: r.added ? r.added.count : r.steps.length, ...(r.added ? { added: true } : {}), at: now() } : { kind: 'error', message: 'Nothing was recording.', at: now() };
    } else if (tab?.id === undefined) {
      out = { kind: 'error', message: 'Open a web page to record on.', at: now() };
    } else {
      await recordingHandlers['rec.start']!({ tabId: tab.id, title: '' }, ctx);
      out = { kind: 'started', tabId: tab.id, at: now() };
    }
  } catch (e) {
    out = { kind: 'error', message: e instanceof Error ? e.message : String(e), at: now() };
  }
  if (tab?.windowId !== undefined) out.windowId = tab.windowId;
  await chrome.storage.session.set({ [SHORTCUT_KEY]: out });
  return out;
}

/** chrome.commands listener for the non-player commands; returns false for others. */
export function onShortcut(command: string, tab: chrome.tabs.Tab | undefined): boolean {
  if (command !== TOGGLE_RECORDING) return false;
  openPanelNow(tab);
  void toggleRecording(tab);
  return true;
}
