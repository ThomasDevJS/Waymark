import type { ComponentChildren } from 'preact';
import { parseInline, type InlineToken } from '../../core/text/markdown';

function render(tokens: InlineToken[], noLinks?: boolean): ComponentChildren {
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'text':
        return t.text;
      case 'br':
        return <br key={i} />;
      case 'bold':
        return <strong key={i}>{render(t.children, noLinks)}</strong>;
      case 'italic':
        return <em key={i}>{render(t.children, noLinks)}</em>;
      case 'link':
        if (noLinks) return t.text;
        return (
          <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">
            {t.text}
          </a>
        );
    }
  });
}

/** Limited markdown (bold, italic, line breaks, https links); never innerHTML. */
/** `noLinks`: links as their text, for places inside a button (D125). */
export function Markdown({ text, noLinks }: { text: string; noLinks?: boolean }) {
  return <>{render(parseInline(text), noLinks)}</>;
}
