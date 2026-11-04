/** Candidate gathering (SPEC: Element targeting, "At playback" step 2). */
import type { ElementFingerprint } from '../model/schema';
import type { ProfileOptions } from '../model/profile';
import { cssEscape, getRole, nearestInteractive, openShadowRoots, rawAccessibleName, rawOwnText, tagOf } from '../fingerprint/dom';
import { GUIDE_ID_ATTR, resolveShadowPath, resolveXPath } from '../fingerprint/selectors';
import { normText } from '../text/normalize';
import { linkPath } from '../url/url';
import { passesTagFilter } from './signals';

export const FALLBACK_CAP = 500;

const IMPLICIT_ROLE_SELECTORS: Record<string, string> = {
  button: 'button, summary, input[type=button], input[type=submit], input[type=reset], input[type=image]',
  link: 'a[href], area[href]',
  textbox: 'input, textarea, [contenteditable]',
  searchbox: 'input[type=search]',
  checkbox: 'input[type=checkbox]',
  radio: 'input[type=radio]',
  combobox: 'select, input[list]',
  listbox: 'select',
  option: 'option',
  slider: 'input[type=range]',
  spinbutton: 'input[type=number]',
};

function roleSelector(role: string): string {
  const implicit = IMPLICIT_ROLE_SELECTORS[role];
  return implicit ? `[role="${cssEscape(role)}"], ${implicit}` : `[role="${cssEscape(role)}"]`;
}

function qsa(root: Document | ShadowRoot, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/** Roots to search: the shadow root at the end of shadowPath, else the document (plus every open shadow root if the path broke). */
export function searchRoots(doc: Document, fp: ElementFingerprint): (Document | ShadowRoot)[] {
  if (!fp.shadowPath.length) return [doc];
  const root = resolveShadowPath(doc, fp.shadowPath);
  if (root) return [root];
  return [doc, ...openShadowRoots(doc)];
}

export function gatherCandidates(
  doc: Document,
  fp: ElementFingerprint,
  opts: { profile?: ProfileOptions; base: string; isVisible: (el: Element) => boolean },
): Element[] {
  const raw = new Set<Element>();
  const roots = searchRoots(doc, fp);
  for (const root of roots) {
    const add = (els: Iterable<Element>) => {
      for (const e of els) raw.add(e);
    };
    if (fp.guideId) add(qsa(root, `[${GUIDE_ID_ATTR}="${cssEscape(fp.guideId)}"]`));
    if (fp.testId) add(qsa(root, `[${cssEscape(fp.testId.attr)}="${cssEscape(fp.testId.value)}"]`));
    if (fp.id) add(qsa(root, `#${cssEscape(fp.id)}`));
    if (fp.name) add(qsa(root, `[name="${cssEscape(fp.name)}"]`));
    if (fp.role && fp.accessibleName) {
      const want = normText(fp.accessibleName);
      add(qsa(root, roleSelector(fp.role)).filter((e) => getRole(e) === fp.role && normText(rawAccessibleName(e)) === want));
    }
    if (fp.text) {
      const want = normText(fp.text);
      const sel = fp.role ? `${cssEscape(fp.tag)}, ${roleSelector(fp.role)}` : cssEscape(fp.tag);
      add(qsa(root, sel).filter((e) => normText(rawOwnText(e)) === want));
    }
    if (fp.placeholder) {
      const want = normText(fp.placeholder);
      add(qsa(root, '[placeholder]').filter((e) => normText(e.getAttribute('placeholder')) === want));
    }
    if (fp.hrefPath) add(qsa(root, '[href]').filter((e) => linkPath(e.getAttribute('href') ?? '', opts.base) === fp.hrefPath));
    if (fp.cssPath) add(qsa(root, fp.cssPath));
    if (fp.xpath) {
      const x = resolveXPath(root, fp.xpath);
      if (x) raw.add(x);
    }
  }
  if (raw.size === 0) {
    // Fallback: every visible element with the same tag or role, capped.
    const sel = fp.role ? `${cssEscape(fp.tag)}, ${roleSelector(fp.role)}` : cssEscape(fp.tag);
    let n = 0;
    for (const root of roots) {
      for (const e of qsa(root, sel)) {
        if (n >= FALLBACK_CAP) break;
        if (opts.isVisible(e)) {
          raw.add(e);
          n++;
        }
      }
    }
  }
  const out = new Set<Element>();
  for (const e of raw) {
    const reduced = nearestInteractive(e) ?? e;
    if (passesTagFilter(reduced, fp)) out.add(reduced);
  }
  return Array.from(out);
}

export { tagOf };
