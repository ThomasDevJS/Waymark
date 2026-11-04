/**
 * Extension context liveness. After an update or reload, a leftover script from the old
 * version loses its extension context; it must detect that and remove its overlay and listeners.
 */
export function contextAlive(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

/** Calls `onDead` once when the extension context goes away (checked every `intervalMs`). */
export function watchContext(onDead: () => void, intervalMs = 2000): () => void {
  const timer = setInterval(() => {
    if (!contextAlive()) {
      clearInterval(timer);
      onDead();
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
