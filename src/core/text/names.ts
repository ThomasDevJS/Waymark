/** Names people read, instead of codes and origins (D123). Pure. */

/** A site as people read it: the host (with a non-default port), without the scheme. */
export function siteLabel(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

/** "en" → "English (en)". Falls back to the code when the browser has no name for it. */
export function languageName(code: string, display = typeof navigator === 'undefined' ? 'en' : navigator.language): string {
  try {
    const name = new Intl.DisplayNames([display], { type: 'language' }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}
