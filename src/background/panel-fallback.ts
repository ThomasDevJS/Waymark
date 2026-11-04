/**
 * Browsers without chrome.sidePanel (reportedly Opera and Arc): the panel opens as a popup,
 * set at runtime only, because a popup in the manifest would block action.onClicked (SPEC A20).
 */
export function setupPanelFallback(api: { sidePanel?: unknown; action: { setPopup(d: { popup: string }): Promise<void> | void } }): boolean {
  if (api.sidePanel) return false;
  void api.action.setPopup({ popup: 'sidepanel.html' });
  return true;
}
