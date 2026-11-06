/**
 * A guide as a text how-to (D104): Markdown, or a printable HTML page. Numbered steps with their
 * titles and notes, the guide title and description, and the start page's origin. The printable
 * page may also show a step's screenshot, when the guide has them and the author kept it (D188).
 * Nothing else: no selectors, element labels, voice text, tags or page paths. A link in a title or
 * note keeps its text; a bare address on the guide's start origin is cut to that origin, and any
 * other address is removed.
 *
 * The author reviews it first, with the same review and removals as a pack (packStrings and
 * applyRemovals), and text that looks like data is flagged (isDataLike, the recorder's filter).
 */
import type { Guide } from '../model/schema';
import { isDataLike, MAX_TEXT } from '../fingerprint/filters';
import { escapeMd, parseInline, type InlineToken } from '../text/markdown';
import type { PackString } from './review';

export type HowtoFormat = 'markdown' | 'html';

/** The start page's origin, the only address a how-to carries. */
export function startOrigin(g: Pick<Guide, 'startUrl'>): string {
  try {
    return new URL(g.startUrl).origin;
  } catch {
    return '';
  }
}

/**
 * Addresses in any common form: a scheme with or without `//` (http, ftp, file, javascript,
 * data, mailto…), a protocol-relative `//host`, `www.…`, and a bare host with a path
 * (`jira.corp.example/browse/FIN-1`). A host without a path is left: it is a name, not a link.
 */
const URLISH = new RegExp(
  [
    String.raw`(?:[a-z][a-z0-9+.-]*:\/\/|\/\/)[^\s<>()]+`,
    String.raw`\b(?:https?|ftp|file|mailto|javascript|data|tel|sms|ws|wss|blob):[^\s<>()]+`,
    String.raw`\bwww\.[^\s<>()]+`,
    String.raw`(?<![\w@./-])(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+(?::\d+)?\/[^\s<>()]*`,
  ].join('|'),
  'gi',
);
const MD_LINK = /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;

/**
 * Removes addresses from raw text (before any markdown is parsed, so `_` or `*` inside an
 * address cannot split it): the start origin's are cut to the origin, others are removed.
 * Backslash escapes of `:`, `/` and `.` are undone first, so `https\://x` is an address too.
 */
export function stripUrls(text: string, origin: string): string {
  return text
    .replace(/\\([:/.])/g, '$1')
    .replace(MD_LINK, '$1')
    .replace(URLISH, (m) => {
      const raw = m.replace(/\\/g, '');
      const href = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : raw.startsWith('//') ? `https:${raw}` : `https://${raw}`;
      try {
        const u = new URL(href);
        return origin && u.origin === origin ? origin : '[link removed]';
      } catch {
        return '[link removed]';
      }
    })
    .replace(/[ \t]{2,}/g, ' ');
}

/** Links that survived as tokens (none should) become their text. */
function clean(tokens: InlineToken[]): InlineToken[] {
  return tokens.map((t) => {
    if (t.type === 'link') return { type: 'text', text: t.text };
    if (t.type === 'bold' || t.type === 'italic') return { ...t, children: clean(t.children) };
    return t;
  });
}

/** Text for Markdown: the subset's own characters, HTML, entities, code and table pipes escaped. */
function mdText(s: string): string {
  return escapeMd(s).replace(/([<>&`|~])/g, '\\$1');
}

/** A line that would start a heading, quote, list, rule or table is made plain text. */
function mdLineStarts(s: string): string {
  return s
    .split('\n')
    .map((line) => line.replace(/^(\s*)([#>+=-])/, '$1\\$2').replace(/^(\s*\d+)([.)])/, '$1\\$2'))
    .join('\n');
}

function toMd(tokens: InlineToken[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'text':
          return mdText(t.text);
        case 'br':
          return '\n';
        case 'bold':
          return `**${toMd(t.children)}**`;
        case 'italic':
          return `*${toMd(t.children)}*`;
        case 'link':
          return mdText(t.text);
      }
    })
    .join('');
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function toHtml(tokens: InlineToken[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'text':
          return escapeHtml(t.text);
        case 'br':
          return '<br>';
        case 'bold':
          return `<strong>${toHtml(t.children)}</strong>`;
        case 'italic':
          return `<em>${toHtml(t.children)}</em>`;
        case 'link':
          // Kept only by withOwnLinks: an http(s) address on the guide's own site, path only.
          return /^https?:\/\//.test(t.href) ? `<a href="${escapeHtml(t.href)}">${escapeHtml(t.text)}</a>` : escapeHtml(t.text);
      }
    })
    .join('');
}

/** A markdown-subset field (step title, note) as safe Markdown or HTML: addresses go first. */
const inlineMd = (src: string, origin: string) => mdLineStarts(toMd(clean(parseInline(stripUrls(src, origin)))));
const inlineHtml = (src: string, origin: string, sites: readonly string[] = []) => toHtml(withOwnLinks(src, origin, sites));
/** A plain-text field (guide title, description). */
const plainMd = (src: string, origin: string) => mdLineStarts(mdText(stripUrls(src, origin)));
const plainHtml = (src: string, origin: string) => escapeHtml(stripUrls(src, origin)).replace(/\n/g, '<br>');

/** Markdown, one section per guide. */
export function howtoMarkdown(guides: Guide[]): string {
  const many = guides.length > 1;
  const out: string[] = [];
  for (const g of guides) {
    const origin = startOrigin(g);
    out.push(`${many ? '##' : '#'} ${plainMd(g.title, origin).replace(/\n/g, ' ')}`, '');
    if (g.description) out.push(plainMd(g.description, origin), '');
    if (origin) out.push(`Start at ${origin}`, '');
    g.steps.forEach((s, i) => {
      const n = `${i + 1}. `;
      const pad = ' '.repeat(n.length);
      // Continuation lines are indented under the number, so they stay in the list item.
      out.push(n + inlineMd(s.title, origin).split('\n').join(`\n${pad}`));
      if (s.note) out.push('', pad + inlineMd(s.note, origin).split('\n').join(`\n${pad}`));
      out.push('');
    });
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Rich text of a step title or note for the preview page (D195): addresses removed, links as text. */
export const howtoInline = (src: string, origin: string, sites: readonly string[] = []): InlineToken[] => withOwnLinks(src, origin, sites);

/**
 * Links in an exported how-to (D159, #85): readers click straight to the app. Only addresses on
 * the guide's own sites, and only their path: the query and fragment can carry data (D104), and
 * links to other sites are still removed. Returns the address to link to, or null.
 */
export function ownLink(href: string, sites: readonly string[]): string | null {
  try {
    const u = new URL(href);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!sites.includes(u.origin)) return null;
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

/** Markers for a kept link while the rest of the text is stripped and parsed (private-use characters). */
const MARK_OPEN = '\uE000';
const MARK_CLOSE = '\uE001';

/**
 * A title or note with its markdown links to the guide's own sites kept as links (path only);
 * every other address goes as before (stripUrls). Without sites, no link is kept.
 */
function withOwnLinks(src: string, origin: string, sites: readonly string[]): InlineToken[] {
  const text = src.replace(/[\uE000\uE001]/g, '');
  const kept: { href: string; text: string }[] = [];
  const marked = sites.length
    ? text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label: string, href: string) => {
        const to = ownLink(href, sites);
        if (!to) return m;
        kept.push({ href: to, text: stripUrls(label, origin) });
        return `${MARK_OPEN}${kept.length - 1}${MARK_CLOSE}`;
      })
    : text;
  const tokens = clean(parseInline(stripUrls(marked, origin)));
  if (!kept.length) return tokens;
  const relink = (ts: InlineToken[]): InlineToken[] =>
    ts.flatMap((t): InlineToken[] => {
      if (t.type === 'bold' || t.type === 'italic') return [{ ...t, children: relink(t.children) }];
      if (t.type !== 'text' || !t.text.includes(MARK_OPEN)) return [t];
      const out: InlineToken[] = [];
      for (const part of t.text.split(new RegExp(`(${MARK_OPEN}\\d+${MARK_CLOSE})`))) {
        const m = new RegExp(`^${MARK_OPEN}(\\d+)${MARK_CLOSE}$`).exec(part);
        const link = m ? kept[Number(m[1])] : undefined;
        if (link) out.push({ type: 'link', href: link.href, text: link.text });
        else if (part) out.push({ type: 'text', text: part.replace(/[\uE000\uE001]/g, '') });
      }
      return out;
    });
  return relink(tokens);
}

/**
 * The page a step happens on, as a link (D159): the step's own address rule on the guide's start
 * site, when it is a plain path (no `:param` stand-ins for ids, no query). Steps inside frames
 * have their frame's address, so they get none.
 */
export function stepPageHref(g: Pick<Guide, 'startUrl'>, step: Pick<Guide['steps'][number], 'url' | 'target'>): string | null {
  const origin = startOrigin(g);
  if (!origin || step.target?.framePath.length) return null;
  const v = step.url.kind === 'pattern' ? step.url.value : null;
  if (!v || !v.startsWith('/') || v.includes('?') || /(^|[/#]):/.test(v)) return null;
  return origin + v;
}

/** Each step's page link, only where the page changes from the step before (a change of page). */
export function stepPageLinks(g: Pick<Guide, 'startUrl' | 'steps'>): (string | null)[] {
  let prev: string | null = startOrigin(g) ? new URL(g.startUrl).origin + new URL(g.startUrl).pathname : null;
  return g.steps.map((s) => {
    const href = stepPageHref(g, s);
    if (!href || href === prev) return null;
    prev = href;
    return href;
  });
}
/** A plain-text field (guide title, description) for the preview page. */
export const howtoPlain = (src: string, origin: string): string => stripUrls(src, origin);

/** Steps in the how-to, for its header. */
export const stepCount = (guides: Pick<Guide, 'steps'>[]) => guides.reduce((n, g) => n + g.steps.length, 0);
export const stepsLabel = (n: number) => (n === 1 ? '1 step' : `${n} steps`);

/**
 * Print layout (D195): light only, a header with the date and the number of steps, a step never
 * split across pages, and screenshots at most about 105 mm tall so two steps fit on a page.
 */
export const PRINT_CSS = `
:root { color-scheme: light; }
body { font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; color: #1b1f27; background: #fff; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.25rem; margin: 2rem 0 .5rem; }
.meta { color: #4a5160; font-size: .9rem; margin: 0 0 1rem; }
.desc { color: #4a5160; margin: 0 0 .5rem; }
.start { color: #4a5160; font-size: .9rem; margin: 0 0 1rem; }
ol { padding-left: 1.6rem; }
li { margin: 0 0 1.4rem; padding-left: .2rem; break-inside: avoid; page-break-inside: avoid; }
li .title { font-weight: 600; }
li .note { margin: .2rem 0 0; color: #4a5160; }
li .shot { margin: .5rem 0 0; }
li .shot img { display: block; width: auto; height: auto; max-width: 100%; border: 1px solid #d5d9e0; border-radius: 6px; }
a { color: #1a56db; }
li a.page { display: inline-block; margin: .15rem 0 0; font-size: .85rem; }
/* Click a screenshot to see it full size (D159, #86): CSS only, the file runs no script. */
.zoom { display: block; position: relative; cursor: zoom-in; }
.zoom input { position: absolute; top: 0; left: 0; width: 1px; height: 1px; opacity: 0; margin: 0; }
.zoom input:focus-visible + img { outline: 3px solid #1a56db; outline-offset: 2px; }
.zoom input:checked + img { position: fixed; inset: 0; margin: auto; max-width: 96vw; max-height: 96vh; z-index: 10; cursor: zoom-out; background: #fff; box-shadow: 0 0 0 100vmax rgba(10, 13, 20, .82); }
footer { margin-top: 2rem; color: #6b7280; font-size: .8rem; }
@page { margin: 14mm; }
@media print {
  .zoom input:checked + img { position: static; max-width: 100%; max-height: 105mm; box-shadow: none; }
  a { color: inherit; }
  body { margin: 0; max-width: none; padding: 0; font-size: 11pt; }
  h1, h2 { break-after: avoid; page-break-after: avoid; }
  li .shot img { max-height: 105mm; }
  footer { display: none; }
}
`;

/** A step's screenshot for the printable page, already drawn (highlight, blur, zoom) by the export (D193). */
export interface HowtoImage {
  /** A `data:image/webp` or `data:image/png` URL; anything else is left out. */
  src: string;
  w: number;
  h: number;
}

export const howtoImageKey = (guideId: string, stepId: string) => `${guideId}|${stepId}`;

const DATA_IMAGE = /^data:image\/(?:webp|png);base64,[A-Za-z0-9+/]+={0,2}$/;

function imageHtml(img: HowtoImage | undefined, n: number): string {
  if (!img || !DATA_IMAGE.test(img.src)) return '';
  const w = Math.max(1, Math.min(4000, Math.round(img.w)));
  const h = Math.max(1, Math.min(4000, Math.round(img.h)));
  // A checkbox with the image after it: checked, the image shows full size (CSS only, D159).
  return `<figure class="shot"><label class="zoom" title="Click to enlarge"><input type="checkbox" aria-label="Enlarge the screenshot of step ${n}"><img src="${img.src}" width="${w}" height="${h}" alt="Screenshot of step ${n}, with the element to use highlighted"></label></figure>`;
}

export interface HowtoHtmlOptions {
  /** The date shown under the title (already formatted); none: no date. */
  date?: string;
}

/**
 * A standalone, printable HTML page: no scripts, no remote resources, every string escaped.
 * Screenshots, if any, are embedded as data URLs (keyed by howtoImageKey).
 */
export function howtoHtml(guides: Guide[], images: ReadonlyMap<string, HowtoImage> = new Map(), opts: HowtoHtmlOptions = {}): string {
  const many = guides.length > 1;
  const first = guides[0];
  const docTitle = many || !first ? 'Guides' : stripUrls(first.title, startOrigin(first));
  const meta = [stepsLabel(stepCount(guides)), ...(opts.date ? [opts.date] : [])].join(' · ');
  const body: string[] = [];
  for (const g of guides) {
    const origin = startOrigin(g);
    const h = many ? 'h2' : 'h1';
    body.push(`<section>`, `<${h}>${plainHtml(g.title, origin)}</${h}>`);
    if (!many) body.push(`<p class="meta">${escapeHtml(meta)}</p>`);
    if (g.description) body.push(`<p class="desc">${plainHtml(g.description, origin)}</p>`);
    if (origin) body.push(`<p class="start">Start at <a href="${escapeHtml(origin)}">${escapeHtml(origin)}</a></p>`);
    body.push('<ol>');
    const pages = stepPageLinks(g);
    g.steps.forEach((s, i) => {
      const img = imageHtml(images.get(howtoImageKey(g.id, s.id)), i + 1);
      const page = pages[i] ? `<a class="page" href="${escapeHtml(pages[i]!)}">Open this page</a>` : '';
      body.push(`<li><div class="title">${inlineHtml(s.title, origin, g.appOrigins)}</div>${page}${s.note ? `<p class="note">${inlineHtml(s.note, origin, g.appOrigins)}</p>` : ''}${img}</li>`);
    });
    body.push('</ol>', '</section>');
  }
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // The page runs nothing and loads nothing (D104).
    // Screenshots are embedded data URLs (D188); nothing is fetched.
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`,
    `<title>${escapeHtml(docTitle)}</title>`,
    `<style>${PRINT_CSS}</style>`,
    '</head>',
    '<body>',
    many ? `<h1>Guides</h1>\n<p class="meta">${escapeHtml(meta)}</p>` : '',
    ...body,
    '<footer>Made with Waymark</footer>',
    '</body>',
    '</html>',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/**
 * What the how-to contains, for the review: the same keys as packStrings, so the same removals
 * apply. Only the description and notes can be removed; titles are changed in the editor.
 */
export function howtoStrings(guides: Guide[]): PackString[] {
  const out: PackString[] = [];
  for (const g of guides) {
    const origin = startOrigin(g);
    out.push({ key: `${g.id}||title`, guideId: g.id, stepIndex: null, kind: 'guide-title', field: 'title', value: g.title, removable: false });
    if (g.description) out.push({ key: `${g.id}||description`, guideId: g.id, stepIndex: null, kind: 'description', field: 'description', value: g.description, removable: true });
    if (origin) out.push({ key: `${g.id}||startUrl`, guideId: g.id, stepIndex: null, kind: 'site', field: 'startUrl', value: origin, removable: false });
    g.steps.forEach((s, i) => {
      out.push({ key: `${g.id}|${s.id}|title`, guideId: g.id, stepIndex: i, kind: 'step-title', field: 'title', value: s.title, removable: false });
      if (s.note) out.push({ key: `${g.id}|${s.id}|note`, guideId: g.id, stepIndex: i, kind: 'note', field: 'note', value: s.note, removable: true });
    });
  }
  return out;
}

/** Kinds of text the data-like check applies to (not addresses or selectors). */
const TEXT_KINDS = new Set<PackString['kind']>(['guide-title', 'description', 'tag', 'step-title', 'note', 'voice', 'label']);

/**
 * True when some part of the text looks like data (an email, an amount, a date, a code, a phone
 * number…), by the recorder's own filter (D66). Long text is checked a few words at a time,
 * because the filter calls anything over 80 characters data.
 */
export function looksLikeData(s: Pick<PackString, 'kind' | 'value'>): boolean {
  if (!TEXT_KINDS.has(s.kind)) return false;
  const words = s.value.replace(/[*_\\]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let chunk = '';
    // One word longer than the filter's limit (an API key, a token) is data by the filter's own rule.
    if (words[i]!.length > MAX_TEXT) return true;
    for (let j = i; j < Math.min(words.length, i + 4); j++) {
      chunk = chunk ? `${chunk} ${words[j]}` : words[j]!;
      if (chunk.length > MAX_TEXT) break;
      if (isDataLike(chunk)) return true;
    }
  }
  return false;
}
