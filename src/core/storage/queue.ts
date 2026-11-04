/**
 * One write queue in the service worker (SPEC: Data model, "Storage"): every read-modify-write
 * runs after the previous one, so related keys never disagree.
 */
let tail: Promise<unknown> = Promise.resolve();

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}
