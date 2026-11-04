/** Fingerprint builder (SPEC: Element targeting, "At record time"). */
import type { ElementFingerprint } from '../model/schema';
import type { ProfileOptions } from '../model/profile';
import { accessibleName, getRole, isVisible as layoutVisible, ownText, tagOf } from './dom';
import { isGeneratedToken, safeLabel } from './filters';
import {
  buildAncestors,
  buildCssPath,
  buildShadowPath,
  buildXPath,
  stableGuideId,
  stableId,
  stableTestId,
} from './selectors';
import { linkPath } from '../url/url';
import { docRect } from '../matcher/signals';
import { countIndistinguishable } from '../matcher/match';

export interface BuildOptions {
  profile?: ProfileOptions;
  /** iframe selectors from the top frame down, resolved through the service worker. */
  framePath?: string[];
  isVisible?: (el: Element) => boolean;
}

/** Builds a fingerprint for an element that has already been resolved to its meaningful target. */
export function buildFingerprint(el: Element, opts: BuildOptions = {}): ElementFingerprint {
  const profile = opts.profile ?? {};
  const doc = el.ownerDocument;
  const tag = tagOf(el);
  const fp: ElementFingerprint = {
    instance: 'unique',
    matchCount: 1,
    tag,
    cssPath: buildCssPath(el, profile),
    xpath: buildXPath(el),
    ancestors: buildAncestors(el),
    shadowPath: buildShadowPath(el, profile),
    framePath: opts.framePath ?? [],
    rect: docRect(el),
  };
  const guideId = stableGuideId(el);
  if (guideId) fp.guideId = guideId;
  const testId = stableTestId(el, profile);
  if (testId) fp.testId = testId;
  const id = stableId(el, profile);
  if (id) fp.id = id;
  const role = getRole(el);
  if (role) fp.role = role;
  const name = accessibleName(el);
  if (name) fp.accessibleName = name;
  const nameAttr = el.getAttribute('name');
  if (nameAttr && !isGeneratedToken(nameAttr, profile.ignorePatterns) && nameAttr.length <= 200) fp.name = nameAttr;
  if (tag === 'input') fp.inputType = (el.getAttribute('type') ?? 'text').toLowerCase();
  const placeholder = safeLabel(el.getAttribute('placeholder'));
  if (placeholder) fp.placeholder = placeholder;
  const text = ownText(el);
  if (text) fp.text = text;
  const href = el.getAttribute('href');
  if (href !== null) {
    const p = linkPath(href, doc.URL);
    if (p && !(p.length > 200)) fp.hrefPath = p;
  }
  const count = countIndistinguishable(doc, fp, { profile, isVisible: opts.isVisible ?? layoutVisible });
  fp.matchCount = Math.max(1, count);
  fp.instance = count > 1 ? 'any' : 'unique';
  return fp;
}
