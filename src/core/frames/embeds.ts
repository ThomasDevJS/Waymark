/**
 * Sites embedded in a page's frames (D155). A frame Waymark runs in reports the origins of its
 * direct child frames, so the side panel can offer Allow for the ones Waymark may not run in yet
 * (an app embedded in Google Sites sits in a googleusercontent.com wrapper, then its own site).
 * Origins only, never paths or queries. No Zod here: the content script imports this.
 */

/** At most this many origins per report, and frames kept per tab. */
export const MAX_EMBED_ORIGINS = 20;
export const MAX_EMBED_FRAMES = 50;

/** The http(s) origin of a frame's address, or null (about:blank, srcdoc, data:, blob:, javascript:). */
export function frameOrigin(src: string, base: string): string | null {
  try {
    const u = new URL(src, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * A frame a person can see: rendered with a size, not hidden. A page could list hidden frames of
 * any site (a mail or bank page) to have the panel offer them (review of D155).
 */
export function frameShown(f: Element): boolean {
  const r = f.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const win = f.ownerDocument.defaultView;
  const cs = win?.getComputedStyle(f);
  if (cs && (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0)) return false;
  return typeof (f as HTMLElement).checkVisibility !== 'function' || (f as HTMLElement).checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

/** Origins of a document's direct, visible child frames (in open shadow roots too), other than its own, sorted. */
export function childFrameOrigins(doc: Document, shown: (f: Element) => boolean = frameShown): string[] {
  const own = doc.location?.origin;
  const out = new Set<string>();
  const visit = (root: Document | ShadowRoot) => {
    for (const f of root.querySelectorAll('iframe, frame')) {
      if (out.size >= MAX_EMBED_ORIGINS) return;
      const src = f.getAttribute('src');
      if (!src || !shown(f)) continue;
      const o = frameOrigin(src, doc.baseURI);
      if (o && o !== own) out.add(o);
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
  };
  visit(doc);
  return [...out].sort();
}

/** A report from a content script, cleaned: real site origins only, no duplicates, capped, sorted. */
export function cleanEmbedOrigins(list: readonly string[], isSite: (o: string) => boolean): string[] {
  return [...new Set(list.filter(isSite))].sort().slice(0, MAX_EMBED_ORIGINS);
}

export type EmbedMap = Record<string, { origins: string[]; at: number }>;

/** Every origin reported in a tab, sorted. */
export function embedOrigins(map: EmbedMap): string[] {
  return [...new Set(Object.values(map).flatMap((e) => e.origins))].sort();
}

/** Stores one frame's report; keeps the newest MAX_EMBED_FRAMES frames. Returns null when nothing changed. */
export function withReport(map: EmbedMap, frameId: number, origins: string[], now: number): EmbedMap | null {
  const prev = map[String(frameId)];
  if (prev && prev.origins.join('\n') === origins.join('\n')) return null;
  const next: EmbedMap = { ...map };
  if (origins.length) next[String(frameId)] = { origins, at: now };
  else delete next[String(frameId)];
  const keys = Object.keys(next).sort((a, b) => next[a]!.at - next[b]!.at);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_EMBED_FRAMES))) delete next[k];
  return next;
}

/** Reports made since `since` (a new top page's start): older ones are of pages before it. Null when nothing goes. */
export function reportsSince(map: EmbedMap, since: number): EmbedMap | null {
  const next = Object.fromEntries(Object.entries(map).filter(([, e]) => e.at >= since));
  return Object.keys(next).length === Object.keys(map).length ? null : next;
}
