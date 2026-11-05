/** What the last recording shortcut did (D105), in session storage for the side panel. */
export const SHORTCUT_KEY = 'shortcut:last';

export type ShortcutOutcome =
  | { kind: 'started'; tabId: number; at: number }
  | { kind: 'stopped'; guideId: string; title: string; count: number; at: number }
  | { kind: 'error'; message: string; at: number };
