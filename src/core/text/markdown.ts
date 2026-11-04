/**
 * Limited markdown renderer (SPEC: Security): bold, italic, line breaks, and https: links that
 * open in a new tab with rel="noopener noreferrer". Builds DOM nodes; user strings never reach
 * innerHTML.
 */
export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineToken[] }
  | { type: 'italic'; children: InlineToken[] }
  | { type: 'br' }
  | { type: 'link'; href: string; text: string };

const LINK = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/;

/** Parses the allowed subset; anything else stays literal text. Backslash escapes a character. */
export function parseInline(src: string): InlineToken[] {
  const out: InlineToken[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\' && i + 1 < src.length) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '\n') {
      flush();
      out.push({ type: 'br' });
      i++;
      continue;
    }
    if (src.startsWith('**', i)) {
      const end = findClose(src, '**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: 'bold', children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (c === '*' || c === '_') {
      const end = findClose(src, c, i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'italic', children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const m = LINK.exec(src.slice(i));
      if (m) {
        flush();
        out.push({ type: 'link', text: m[1]!, href: m[2]! });
        i += m[0].length;
        continue;
      }
    }
    text += c;
    i++;
  }
  flush();
  return out;
}

function findClose(src: string, marker: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === '\\') {
      j++;
      continue;
    }
    if (src.startsWith(marker, j)) return j;
  }
  return -1;
}

export function renderInline(src: string, doc: Document = document): Node[] {
  const build = (tokens: InlineToken[]): Node[] =>
    tokens.map((t) => {
      switch (t.type) {
        case 'text':
          return doc.createTextNode(t.text);
        case 'br':
          return doc.createElement('br');
        case 'bold': {
          const el = doc.createElement('strong');
          el.append(...build(t.children));
          return el;
        }
        case 'italic': {
          const el = doc.createElement('em');
          el.append(...build(t.children));
          return el;
        }
        case 'link': {
          const a = doc.createElement('a');
          a.href = t.href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = t.text;
          return a;
        }
      }
    });
  return build(parseInline(src));
}

/** Plain text (for voice and search). */
export function toPlainText(src: string): string {
  const walk = (tokens: InlineToken[]): string =>
    tokens.map((t) => (t.type === 'text' ? t.text : t.type === 'br' ? '\n' : t.type === 'link' ? t.text : walk(t.children))).join('');
  return walk(parseInline(src));
}

/** Escapes markdown characters in a label inserted into a template. */
export function escapeMd(s: string): string {
  return s.replace(/([\\*_[\]])/g, '\\$1');
}

/**
 * A title that came from a content script: recorder titles escape every page label, so a live
 * link can only be forged. Such a title is kept as plain, escaped text (D47).
 */
export function withoutLinks(src: string): string {
  const hasLink = (tokens: InlineToken[]): boolean => tokens.some((t) => t.type === 'link' || ((t.type === 'bold' || t.type === 'italic') && hasLink(t.children)));
  return hasLink(parseInline(src)) ? escapeMd(toPlainText(src)) : src;
}
