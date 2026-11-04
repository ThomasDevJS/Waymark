import type { ComponentChildren } from 'preact';
import { parseInline, type InlineToken } from '../../core/text/markdown';

function render(tokens: InlineToken[]): ComponentChildren {
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'text':
        return t.text;
      case 'br':
        return <br key={i} />;
      case 'bold':
        return <strong key={i}>{render(t.children)}</strong>;
      case 'italic':
        return <em key={i}>{render(t.children)}</em>;
      case 'link':
        return (
          <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">
            {t.text}
          </a>
        );
    }
  });
}

/** Limited markdown (bold, italic, line breaks, https links); never innerHTML. */
export function Markdown({ text }: { text: string }) {
  return <>{render(parseInline(text))}</>;
}
