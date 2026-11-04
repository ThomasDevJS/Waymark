/** Trim, collapse whitespace. Keeps case (for display). */
export function cleanText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Comparison form used by the matcher: trimmed, whitespace collapsed, lower-cased. No fuzzy matching. */
export function normText(s: string | null | undefined): string {
  return cleanText(s).toLowerCase();
}
