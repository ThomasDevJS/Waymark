/** Selector builders: CSS path from stable parts, positional XPath, landmarks, shadow paths. */
import type { Landmark } from '../model/schema';
import type { ProfileOptions } from '../model/profile';
import { isDataLikeAttr, isGeneratedToken, isStateClass, safeLabel } from './filters';
import { composedParent, cssEscape, getRole, LANDMARK_ROLES, rawAccessibleName, rootOf, tagOf } from './dom';
import { cleanText } from '../text/normalize';

export const DEFAULT_TEST_ID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];
export const GUIDE_ID_ATTR = 'data-guide-id';

export function testIdAttrs(profile: ProfileOptions = {}): string[] {
  return [...DEFAULT_TEST_ID_ATTRS, ...(profile.stableAttributes ?? []).filter((a) => !DEFAULT_TEST_ID_ATTRS.includes(a))];
}

/** Ids, test ids and key attributes: stable, and never data such as an email or amount (D66). */
function attrValueOk(v: string | null, profile: ProfileOptions): v is string {
  return !!v && v.length <= 200 && !isGeneratedToken(v, profile.ignorePatterns) && !isDataLikeAttr(v);
}

export function stableTestId(el: Element, profile: ProfileOptions = {}): { attr: string; value: string } | undefined {
  for (const attr of testIdAttrs(profile)) {
    const v = el.getAttribute(attr);
    if (attrValueOk(v, profile)) return { attr, value: v };
  }
  return undefined;
}

export function stableGuideId(el: Element): string | undefined {
  const v = el.getAttribute(GUIDE_ID_ATTR);
  return v && v.length <= 200 && !isDataLikeAttr(v) ? v : undefined;
}

/** An id is stable when it does not look generated and is unique in its root. */
export function stableId(el: Element, profile: ProfileOptions = {}): string | undefined {
  const id = el.getAttribute('id');
  if (!id || !attrValueOk(id, profile)) return undefined;
  const root = rootOf(el);
  const same = root.querySelectorAll(`#${cssEscape(id)}`);
  return same.length === 1 ? id : undefined;
}

export function stableClasses(el: Element, profile: ProfileOptions = {}): string[] {
  return Array.from(el.classList)
    .filter((c) => c.length <= 60 && !isStateClass(c) && !isGeneratedToken(c, profile.ignorePatterns) && !isDataLikeAttr(c))
    .slice(0, 4);
}

const KEY_ATTRS = ['name', 'type', 'role'];

interface Segment {
  selector: string;
  anchor: boolean;
  informative: boolean;
}

function segmentFor(el: Element, isTarget: boolean, profile: ProfileOptions): Segment {
  const tag = tagOf(el);
  const sel = cssEscape(tag);
  const guideId = stableGuideId(el);
  if (guideId) return { selector: `${sel}[${GUIDE_ID_ATTR}="${cssEscape(guideId)}"]`, anchor: true, informative: true };
  const testId = stableTestId(el, profile);
  if (testId) return { selector: `${sel}[${testId.attr}="${cssEscape(testId.value)}"]`, anchor: true, informative: true };
  const id = stableId(el, profile);
  if (id) return { selector: `${sel}#${cssEscape(id)}`, anchor: true, informative: true };
  let s = sel;
  const classes = stableClasses(el, profile);
  for (const c of classes) s += `.${cssEscape(c)}`;
  let informative = classes.length > 0;
  if (isTarget) {
    for (const a of KEY_ATTRS) {
      const v = el.getAttribute(a);
      if (v && v.length <= 60 && !isGeneratedToken(v, profile.ignorePatterns) && !isDataLikeAttr(v)) s += `[${a}="${cssEscape(v)}"]`;
    }
  } else {
    const role = el.getAttribute('role');
    if (role && /^[a-z]+$/.test(role)) {
      s += `[role="${role}"]`;
      informative = true;
    }
    // A short, non-data aria-label on an ancestor (a named form, region or card) is a stable
    // attribute and is what tells look-alike buttons apart.
    const label = safeLabel(el.getAttribute('aria-label'));
    if (label && label.length <= 60) {
      s += `[aria-label="${cssEscape(label)}"]`;
      informative = true;
    }
  }
  return { selector: s, anchor: false, informative };
}

/**
 * CSS path built from stable attributes and classes only, relative to the element's own root
 * (document or shadow root). Uses descendant combinators so extra wrappers do not break it,
 * skips ancestors with nothing stable, and stops at the first anchored ancestor.
 */
export function buildCssPath(el: Element, profile: ProfileOptions = {}, maxDepth = 5): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && depth <= maxDepth) {
    const tag = tagOf(node);
    if (tag === 'html' || tag === 'body') break;
    const seg = segmentFor(node, node === el, profile);
    if (node === el || seg.informative) parts.unshift(seg.selector);
    if (seg.anchor) break;
    node = node.parentElement; // stays inside the current root
    depth++;
  }
  return parts.join(' ');
}

/** Positional XPath within the element's root, e.g. `/html[1]/body[1]/div[2]/button[1]`. */
export function buildXPath(el: Element): string {
  const segs: string[] = [];
  let node: Element | null = el;
  while (node) {
    const tag = tagOf(node);
    let index = 1;
    for (let s = node.previousElementSibling; s; s = s.previousElementSibling) if (tagOf(s) === tag) index++;
    segs.unshift(`${tag}[${index}]`);
    node = node.parentElement;
  }
  return '/' + segs.join('/');
}

/** Resolve a positional XPath produced by buildXPath, inside a document or shadow root. */
export function resolveXPath(root: Document | ShadowRoot, xpath: string): Element | null {
  const segs = xpath.split('/').filter(Boolean);
  let parent: ParentNode = root;
  let current: Element | null = null;
  for (const seg of segs) {
    const m = /^([^[]+)\[(\d+)\]$/.exec(seg);
    if (!m) return null;
    const tag = m[1]!;
    let n = Number(m[2]);
    current = null;
    for (const child of Array.from(parent.children)) {
      if (tagOf(child) === tag && --n === 0) {
        current = child;
        break;
      }
    }
    if (!current) return null;
    parent = current;
  }
  return current;
}

function landmarkLabel(el: Element): string | undefined {
  const raw = rawAccessibleName(el);
  if (raw) return safeLabel(raw);
  const tag = tagOf(el);
  if (tag === 'fieldset') {
    const legend = el.querySelector(':scope > legend');
    if (legend) return safeLabel(cleanText(legend.textContent));
  }
  if (tag === 'table') {
    const caption = el.querySelector(':scope > caption');
    if (caption) return safeLabel(cleanText(caption.textContent));
  }
  return undefined;
}

/** Up to 3 nearest landmark ancestors (nearest first), crossing open shadow boundaries. */
export function buildAncestors(el: Element, max = 3): Landmark[] {
  const out: Landmark[] = [];
  let node = composedParent(el);
  while (node && out.length < max) {
    const role = getRole(node);
    if (role && LANDMARK_ROLES.has(role)) {
      const lm: Landmark = { tag: tagOf(node), role };
      const label = landmarkLabel(node);
      if (label) lm.label = label;
      out.push(lm);
    }
    node = composedParent(node);
  }
  return out;
}

export function landmarksEqual(a: Landmark[], b: Landmark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return x.tag === y.tag && x.role === y.role && (x.label ?? '').toLowerCase() === (y.label ?? '').toLowerCase();
  });
}

const XPATH_PREFIX = 'xpath:';

/** Selector for a shadow host inside its own root: CSS path when unique there, XPath otherwise. */
export function hostSelector(host: Element, profile: ProfileOptions = {}): string {
  const css = buildCssPath(host, profile);
  try {
    if (rootOf(host).querySelectorAll(css).length === 1) return css;
  } catch {
    // fall through
  }
  return XPATH_PREFIX + buildXPath(host);
}

/** Every element a host selector matches in a root: all CSS matches, or the one XPath target. */
export function resolveSelectorAll(root: Document | ShadowRoot, selector: string): Element[] {
  if (selector.startsWith(XPATH_PREFIX)) {
    const el = resolveXPath(root, selector.slice(XPATH_PREFIX.length));
    return el ? [el] : [];
  }
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/**
 * Selector for a host on a shadow path: its CSS path, even when other hosts match it too. Every
 * match is searched at playback, so a twin widget is as ambiguous as a twin in the light DOM
 * (docs/DECISIONS.md R6). XPath only when the CSS path does not select the host at all.
 */
export function shadowHostSelector(host: Element, profile: ProfileOptions = {}): string {
  const css = buildCssPath(host, profile);
  try {
    if (Array.from(rootOf(host).querySelectorAll(css)).includes(host)) return css;
  } catch {
    // fall through
  }
  return XPATH_PREFIX + buildXPath(host);
}

/** Open shadow host selectors from the outermost to the innermost host. */
export function buildShadowPath(el: Element, profile: ProfileOptions = {}): string[] {
  const out: string[] = [];
  let root = el.getRootNode();
  while (root instanceof ShadowRoot) {
    out.unshift(shadowHostSelector(root.host, profile));
    root = root.host.getRootNode();
  }
  return out;
}

/**
 * The open shadow roots a shadow path reaches, level by level (outermost first). Each step
 * resolves to every host it matches in every root of the level above. Stops after the first
 * level with no root.
 */
export function shadowPathLevels(doc: Document, path: string[]): ShadowRoot[][] {
  const levels: ShadowRoot[][] = [];
  let roots: (Document | ShadowRoot)[] = [doc];
  for (const sel of path) {
    const next: ShadowRoot[] = [];
    for (const root of roots) {
      for (const host of resolveSelectorAll(root, sel)) {
        const sr = host.shadowRoot;
        if (sr && !next.includes(sr)) next.push(sr);
      }
    }
    levels.push(next);
    if (!next.length) break;
    roots = next;
  }
  return levels;
}

/** Every innermost open shadow root of a path ([doc] for an empty path), or null when a step matches no open host. */
export function resolveShadowPathAll(doc: Document, path: string[]): (Document | ShadowRoot)[] | null {
  if (!path.length) return [doc];
  const levels = shadowPathLevels(doc, path);
  const last = levels.length === path.length ? levels[levels.length - 1] : undefined;
  return last && last.length ? last : null;
}
