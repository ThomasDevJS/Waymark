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
          return escapeHtml(t.text);
      }
    })
    .join('');
}

/** A markdown-subset field (step title, note) as safe Markdown or HTML: addresses go first. */
const inlineMd = (src: string, origin: string) => mdLineStarts(toMd(clean(parseInline(stripUrls(src, origin)))));
const inlineHtml = (src: string, origin: string) => toHtml(clean(parseInline(stripUrls(src, origin))));
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

const PRINT_CSS = `
:root { color-scheme: light dark; }
body { font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; color: #1b1f27; background: #fff; }
h1 { font-size: 1.6rem; margin: 0 0 .5rem; }
h2 { font-size: 1.25rem; margin: 2rem 0 .5rem; }
.desc { color: #4a5160; margin: 0 0 .5rem; }
.start { color: #4a5160; font-size: .9rem; margin: 0 0 1rem; }
ol { padding-left: 1.6rem; }
li { margin: 0 0 .8rem; padding-left: .2rem; break-inside: avoid; }
li .title { font-weight: 600; }
li .note { margin: .2rem 0 0; color: #4a5160; }
li .shot { margin: .5rem 0 0; }
li .shot img { display: block; max-width: 100%; height: auto; border: 1px solid #d5d9e0; border-radius: 6px; }
footer { margin-top: 2rem; color: #6b7280; font-size: .8rem; }
@media (prefers-color-scheme: dark) { @media screen { body { background: #15171c; color: #e5e7ec; } .desc, .start, li .note { color: #a9b0bd; } } }
@media print { body { margin: 0; max-width: none; } footer { display: none; } }
`;

/** A step's screenshot for the printable page, already marked (and blurred) by the export (D188). */
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
  return `<figure class="shot"><img src="${img.src}" width="${w}" height="${h}" alt="Screenshot of step ${n}, with the element to use outlined"></figure>`;
}

/**
 * A standalone, printable HTML page: no scripts, no remote resources, every string escaped.
 * Screenshots, if any, are embedded as data URLs (keyed by howtoImageKey).
 */
export function howtoHtml(guides: Guide[], images: ReadonlyMap<string, HowtoImage> = new Map()): string {
  const many = guides.length > 1;
  const first = guides[0];
  const docTitle = many || !first ? 'Guides' : stripUrls(first.title, startOrigin(first));
  const body: string[] = [];
  for (const g of guides) {
    const origin = startOrigin(g);
    const h = many ? 'h2' : 'h1';
    body.push(`<section>`, `<${h}>${plainHtml(g.title, origin)}</${h}>`);
    if (g.description) body.push(`<p class="desc">${plainHtml(g.description, origin)}</p>`);
    if (origin) body.push(`<p class="start">Start at ${escapeHtml(origin)}</p>`);
    body.push('<ol>');
    g.steps.forEach((s, i) => {
      const img = imageHtml(images.get(howtoImageKey(g.id, s.id)), i + 1);
      body.push(`<li><div class="title">${inlineHtml(s.title, origin)}</div>${s.note ? `<p class="note">${inlineHtml(s.note, origin)}</p>` : ''}${img}</li>`);
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
    many ? '<h1>Guides</h1>' : '',
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
