/**
 * A guide as a text how-to (D104): Markdown, or a printable HTML page. Numbered steps with their
 * titles and notes, the guide title and description, and the start page's origin. Nothing else:
 * no screenshots, selectors, element labels, voice text, tags or page paths. A link in a title or
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

const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;

/** Removes addresses from text: the start origin's are cut to the origin, others go. */
export function stripUrls(text: string, origin: string): string {
  return text
    .replace(BARE_URL, (m) => {
      try {
        const u = new URL(m.startsWith('www.') ? `https://${m}` : m);
        return u.origin === origin ? origin : '[link removed]';
      } catch {
        return '[link removed]';
      }
    })
    .replace(/[ \t]{2,}/g, ' ');
}

/** Tokens with links turned into their text, and addresses stripped from all text. */
function clean(tokens: InlineToken[], origin: string): InlineToken[] {
  return tokens.map((t) => {
    if (t.type === 'text') return { type: 'text', text: stripUrls(t.text, origin) };
    if (t.type === 'link') return { type: 'text', text: stripUrls(t.text, origin) };
    if (t.type === 'bold' || t.type === 'italic') return { ...t, children: clean(t.children, origin) };
    return t;
  });
}

function toMd(tokens: InlineToken[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'text':
          return escapeMd(t.text);
        case 'br':
          return '\n';
        case 'bold':
          return `**${toMd(t.children)}**`;
        case 'italic':
          return `*${toMd(t.children)}*`;
        case 'link':
          return escapeMd(t.text);
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

/** A markdown-subset field (step title, note) as safe Markdown or HTML. */
const inlineMd = (src: string, origin: string) => toMd(clean(parseInline(src), origin));
const inlineHtml = (src: string, origin: string) => toHtml(clean(parseInline(src), origin));
/** A plain-text field (guide title, description). */
const plainMd = (src: string, origin: string) => escapeMd(stripUrls(src, origin));
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
footer { margin-top: 2rem; color: #6b7280; font-size: .8rem; }
@media (prefers-color-scheme: dark) { @media screen { body { background: #15171c; color: #e5e7ec; } .desc, .start, li .note { color: #a9b0bd; } } }
@media print { body { margin: 0; max-width: none; } footer { display: none; } }
`;

/** A standalone, printable HTML page: no scripts, no remote resources, every string escaped. */
export function howtoHtml(guides: Guide[]): string {
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
    for (const s of g.steps) {
      body.push(`<li><div class="title">${inlineHtml(s.title, origin)}</div>${s.note ? `<p class="note">${inlineHtml(s.note, origin)}</p>` : ''}</li>`);
    }
    body.push('</ol>', '</section>');
  }
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // The page runs nothing and loads nothing (D104).
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
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
    for (let j = i; j < Math.min(words.length, i + 4); j++) {
      chunk = chunk ? `${chunk} ${words[j]}` : words[j]!;
      if (chunk.length > MAX_TEXT) break;
      if (isDataLike(chunk)) return true;
    }
  }
  return false;
}
