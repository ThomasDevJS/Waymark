/** What the last recording shortcut did (D105), in session storage for the side panel. */
export const SHORTCUT_KEY = 'shortcut:last';

/** `windowId`: the window the key was pressed in; only its side panel follows the outcome. */
export type ShortcutOutcome = (
  | { kind: 'started'; tabId: number }
  | { kind: 'stopped'; guideId: string; title: string; count: number; /** Steps recorded into an existing guide (D202). */ added?: boolean }
  | { kind: 'error'; message: string }
) & { at: number; windowId?: number };
