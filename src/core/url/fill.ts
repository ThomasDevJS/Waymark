/**
 * A step's page from its address rule, with the ids filled in from the page the learner is on
 * (D203). Rules keep no ids (D33): `/o/:id/fleet/list`. On the same site, the current address
 * usually has them in the same place (`/o/12345/dashboard`), so the start page can be opened for
 * the learner instead of showing them a pattern. A stand-in is filled only when every fixed part
 * of the rule before it matches the current address, so an id is never taken from an unrelated
 * place. Pure.
 */
export function fillRule(rule: string, origin: string, current: string | null | undefined): string | null {
  if (!current) return null;
  let cur: URL;
  try {
    cur = new URL(current);
  } catch {
    return null;
  }
  if (cur.origin !== origin || !rule.startsWith('/')) return null;
  // The path, and whatever follows it (a hash route or query) kept as written.
  const cut = rule.search(/[?#]/);
  const path = cut < 0 ? rule : rule.slice(0, cut);
  const rest = cut < 0 ? '' : rule.slice(cut);
  if (/[?#].*:/.test(rest)) return null; // stand-ins outside the path: nothing to fill them from
  const want = path.split('/');
  const have = cur.pathname.split('/');
  const out: string[] = [];
  for (let i = 0; i < want.length; i++) {
    const seg = want[i]!;
    if (!seg.startsWith(':')) {
      out.push(seg);
      continue;
    }
    const value = have[i];
    // Every fixed segment before this one must match the current address.
    const prefixMatches = want.slice(0, i).every((w, j) => w.startsWith(':') || w === have[j]);
    if (!value || !prefixMatches) return null;
    out.push(value);
  }
  return origin + out.join('/') + rest;
}
