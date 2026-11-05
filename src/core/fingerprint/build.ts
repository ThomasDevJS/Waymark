/** Fingerprint builder (SPEC: Element targeting, "At record time"). */
import type { ElementFingerprint } from '../model/schema';
import type { ProfileOptions } from '../model/profile';
import { accessibleName, displayBox, getRole, inputTypeOf, isVisible as layoutVisible, itemLabel, ownText, tagOf } from './dom';
import { isDataLikeAttr, isGeneratedToken, safeLabel } from './filters';
import {
  buildAncestors,
  buildCssPath,
  buildShadowPath,
  buildXPath,
  stableGuideId,
  stableId,
  stableTestId,
} from './selectors';
import { isSamePageHref, linkPath } from '../url/url';
import { docRect, IDENTIFYING, presentSignals } from '../matcher/signals';
import { recordTimeScan } from '../matcher/match';

export interface BuildOptions {
  profile?: ProfileOptions;
  /** iframe selectors from the top frame down, resolved through the service worker. */
  framePath?: string[];
  isVisible?: (el: Element) => boolean;
}

/** Builds a fingerprint for an element that has already been resolved to its meaningful target. */
export function buildFingerprint(el: Element, opts: BuildOptions = {}): ElementFingerprint {
  const profile = opts.profile ?? {};
  const isVis = opts.isVisible ?? layoutVisible;
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
    // A visually hidden control is on screen as its label (custom checkboxes; DECISIONS R7).
    rect: docRect(displayBox(el, isVis) ?? el),
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
  if (nameAttr && !isGeneratedToken(nameAttr, profile.ignorePatterns) && !isDataLikeAttr(nameAttr) && nameAttr.length <= 200) fp.name = nameAttr;
  if (tag === 'input') {
    fp.inputType = inputTypeOf(el);
    // A radio's or checkbox's `name` is shared by its whole group; its value attribute (set by
    // the page author, never typed) says which option it is (docs/DECISIONS.md R4).
    if (fp.inputType === 'radio' || fp.inputType === 'checkbox') {
      const value = el.getAttribute('value');
      if (value && value.length <= 200 && safeLabel(value) && !isGeneratedToken(value, profile.ignorePatterns)) fp.value = value;
    }
  }
  const placeholder = safeLabel(el.getAttribute('placeholder'));
  if (placeholder) fp.placeholder = placeholder;
  const text = ownText(el);
  if (text) fp.text = text;
  // A control with no name and no text of its own is named by its list item or row (D65).
  if (!fp.accessibleName && !fp.text) {
    const item = itemLabel(el);
    if (item) fp.itemLabel = item;
  }
  const href = el.getAttribute('href');
  // A link back to the current page (`#`, `#top`, `?page=2`) has the page's own path: no identity.
  if (href !== null && !isSamePageHref(href)) {
    const p = linkPath(href, doc.URL);
    if (p && !(p.length > 200)) fp.hrefPath = p;
  }
  const scan = recordTimeScan(doc, fp, el, { profile, isVisible: isVis });
  const count = scan.count;
  fp.matchCount = Math.max(1, count);
  // Repeated only when the group shares what identifies an element (text, role + name, test id,
  // id), not just a group-level signal such as a shared `name` or link path (docs/DECISIONS.md R5).
  fp.instance = count > 1 && presentSignals(fp).some((k) => IDENTIFYING.has(k)) ? 'any' : 'unique';
  // What the page's look-alikes match, so playback never takes one for the target (D64).
  if (fp.instance === 'unique' && scan.lookalikes.length) fp.lookalikes = scan.lookalikes;
  return fp;
}
