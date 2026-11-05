/**
 * Splits step text into pieces the model reads one at a time: sentences, and long sentences at
 * commas or spaces (Kokoro reads at most 510 phoneme tokens at once).
 */
const MAX_CHARS = 300;

export function splitSentences(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    let rest = s;
    while (rest.length > MAX_CHARS) {
      const head = rest.slice(0, MAX_CHARS);
      const cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '));
      const at = cut > MAX_CHARS / 3 ? cut + 1 : head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : MAX_CHARS;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}
