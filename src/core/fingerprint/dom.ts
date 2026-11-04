/**
 * DOM helpers shared by the fingerprint builder and the matcher: roles, accessible names,
 * own text, interactive resolution, visibility. All functions work inside open shadow roots.
 */
import { cleanText } from '../text/normalize';
import { safeLabel } from './filters';

export const WIDGET_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'combobox',
  'textbox',
  'searchbox',
  'slider',
  'spinbutton',
  'treeitem',
]);

/** Roles named in the spec as interactive widget roles; textbox/searchbox etc. come from native tags. */
const SPEC_WIDGET_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'combobox',
]);

export const LANDMARK_ROLES = new Set([
  'banner',
  'navigation',
  'main',
  'complementary',
  'contentinfo',
  'search',
  'form',
  'region',
  'dialog',
  'alertdialog',
  'toolbar',
  'menu',
  'menubar',
  'tablist',
  'tabpanel',
  'grid',
  'table',
  'listbox',
  'tree',
  'group',
]);

export function tagOf(el: Element): string {
  return el.localName.toLowerCase();
}

/** Parent in the composed tree: parentElement, or the shadow host when at a shadow root. */
export function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export function rootOf(el: Element): Document | ShadowRoot {
  const r = el.getRootNode();
  return r instanceof ShadowRoot || r instanceof Document ? r : el.ownerDocument;
}

function explicitRole(el: Element): string | undefined {
  const r = el.getAttribute('role');
  if (!r) return undefined;
  const first = r.trim().split(/\s+/)[0];
  return first ? first.toLowerCase() : undefined;
}

function hasAccessibleNameAttr(el: Element): boolean {
  return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
}

/** Explicit role, or the implicit ARIA role of common HTML elements. */
export function getRole(el: Element): string | undefined {
  const explicit = explicitRole(el);
  if (explicit && explicit !== 'presentation' && explicit !== 'none') return explicit;
  const tag = tagOf(el);
  switch (tag) {
    case 'a':
    case 'area':
      return el.hasAttribute('href') ? 'link' : undefined;
    case 'button':
      return 'button';
    case 'summary':
      return 'button';
    case 'input': {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return el.hasAttribute('list') ? 'combobox' : 'searchbox';
      if (type === 'hidden' || type === 'file' || type === 'color') return undefined;
      return el.hasAttribute('list') ? 'combobox' : 'textbox';
    }
    case 'select': {
      const multiple = el.hasAttribute('multiple');
      const size = Number(el.getAttribute('size') ?? '0');
      return multiple || size > 1 ? 'listbox' : 'combobox';
    }
    case 'textarea':
      return 'textbox';
    case 'option':
      return 'option';
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'aside':
      return 'complementary';
    case 'header':
      return el.closest('article, aside, main, nav, section') ? undefined : 'banner';
    case 'footer':
      return el.closest('article, aside, main, nav, section') ? undefined : 'contentinfo';
    case 'form':
      return hasAccessibleNameAttr(el) || el.hasAttribute('name') ? 'form' : undefined;
    case 'section':
      return hasAccessibleNameAttr(el) ? 'region' : undefined;
    case 'search':
      return 'search';
    case 'dialog':
      return 'dialog';
    case 'table':
      return 'table';
    case 'fieldset':
      return 'group';
    case 'ul':
    case 'ol':
      return 'list';
    case 'li':
      return 'listitem';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'img':
      return el.getAttribute('alt') === '' ? undefined : 'img';
    default:
      if (isContentEditable(el)) return 'textbox';
      return undefined;
  }
}

function isContentEditable(el: Element): boolean {
  const v = el.getAttribute('contenteditable');
  return v !== null && v.toLowerCase() !== 'false';
}

/** SPEC record step 1: a[href], button, input, select, textarea, summary, [contenteditable], or a widget role. */
export function isInteractive(el: Element): boolean {
  const tag = tagOf(el);
  if (tag === 'a') return el.hasAttribute('href');
  if (['button', 'select', 'textarea', 'summary'].includes(tag)) return true;
  if (tag === 'input') return (el.getAttribute('type') ?? '').toLowerCase() !== 'hidden';
  if (isContentEditable(el)) {
    // only the editing host, not every descendant
    const parent = composedParent(el);
    return !parent || !isContentEditable(parent);
  }
  const role = explicitRole(el);
  return role !== undefined && SPEC_WIDGET_ROLES.has(role);
}

/** The form control a <label> points at, or null. */
export function labelControl(label: Element): Element | null {
  const l = label as HTMLLabelElement;
  if ('control' in l && l.control) return l.control;
  const forId = label.getAttribute('for');
  if (forId) return rootOf(label).getElementById?.(forId) ?? null;
  return label.querySelector('input:not([type=hidden]), select, textarea, button');
}

/** Nearest interactive element at most `maxLevels` composed ancestors up. A <label> resolves to its control. */
export function nearestInteractive(start: Element, maxLevels = 5): Element | null {
  let el: Element | null = start;
  for (let level = 0; el && level <= maxLevels; level++) {
    if (tagOf(el) === 'label') {
      const control = labelControl(el);
      if (control) return control;
    }
    if (isInteractive(el)) return el;
    el = composedParent(el);
  }
  return null;
}

export interface ResolvedTarget {
  element: Element;
  /** True when no interactive element was found (a click on a non-interactive area). */
  lowConfidence: boolean;
}

/** SPEC record step 1, from `event.composedPath()`. */
export function resolveTargetFromPath(path: EventTarget[]): ResolvedTarget | null {
  const elements = path.filter((t): t is Element => t instanceof Element);
  const first = elements[0];
  if (!first) return null;
  for (let i = 0; i < elements.length && i <= 5; i++) {
    const el = elements[i]!;
    if (tagOf(el) === 'label') {
      const control = labelControl(el);
      if (control) return { element: control, lowConfidence: false };
    }
    if (isInteractive(el)) return { element: el, lowConfidence: false };
  }
  return { element: first, lowConfidence: true };
}

function textOfIds(el: Element, ids: string): string {
  const root = rootOf(el);
  return ids
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => {
      const ref = root.getElementById?.(id) ?? el.ownerDocument.getElementById(id);
      return ref ? cleanText(ref.textContent) : '';
    })
    .filter(Boolean)
    .join(' ');
}

/** Text of a label without the text of controls nested inside it. */
function labelText(label: Element): string {
  const clone = label.cloneNode(true) as Element;
  clone.querySelectorAll('input, select, textarea, button, script, style').forEach((n) => n.remove());
  return cleanText(clone.textContent);
}

const NAME_FROM_CONTENT_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'option', 'switch', 'checkbox', 'radio', 'treeitem']);

function isNameFromContent(el: Element): boolean {
  const tag = tagOf(el);
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return false;
  const role = getRole(el);
  return role !== undefined && NAME_FROM_CONTENT_ROLES.has(role);
}

/** Name of the first icon inside an element: img alt, aria-label, or an svg <title>. */
function iconName(el: Element): string | undefined {
  for (const d of Array.from(el.querySelectorAll('img[alt], [aria-label], svg title')).slice(0, 10)) {
    const hidden = d.closest('[aria-hidden="true"]');
    if (hidden && el.contains(hidden)) continue; // hidden icons do not name their button
    const t = d.tagName.toLowerCase() === 'img' ? d.getAttribute('alt') : d.tagName.toLowerCase() === 'title' ? d.textContent : d.getAttribute('aria-label');
    const name = cleanText(t);
    if (name) return name;
  }
  return undefined;
}

/** Raw accessible name per the spec's sources: aria-labelledby, aria-label or <label> text. Unfiltered. */
export function rawAccessibleName(el: Element): string | undefined {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const t = textOfIds(el, labelledBy);
    if (t) return t;
  }
  const aria = cleanText(el.getAttribute('aria-label'));
  if (aria) return aria;
  const tag = tagOf(el);
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button') {
    const labels: Element[] = [];
    const native = (el as HTMLInputElement).labels;
    if (native && native.length) labels.push(...Array.from(native));
    else {
      const id = el.getAttribute('id');
      if (id) {
        const root = rootOf(el);
        root.querySelectorAll(`label[for="${cssEscape(id)}"]`).forEach((l) => labels.push(l));
      }
      const wrapping = el.closest('label');
      if (wrapping && !labels.includes(wrapping)) labels.push(wrapping);
    }
    const t = labels.map(labelText).filter(Boolean).join(' ');
    if (t) return t;
  }
  // Buttons and links with no text of their own: the name of the icon inside (img alt, an
  // aria-label or <title> on an svg or icon element), as browsers compute it. See D23.
  if (isNameFromContent(el) && !rawOwnText(el)) {
    const icon = iconName(el);
    if (icon) return icon;
  }
  // Fallbacks browsers use for fields with no label (accname: title, then placeholder).
  // See docs/DECISIONS.md: without them a placeholder-only search box has no strong signal.
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const title = cleanText(el.getAttribute('title'));
    if (title) return title;
    const placeholder = cleanText(el.getAttribute('placeholder'));
    if (placeholder) return placeholder;
  }
  return undefined;
}

/** Accessible name, or undefined when missing or data-like. */
export function accessibleName(el: Element): string | undefined {
  return safeLabel(rawAccessibleName(el));
}

const NO_TEXT_TAGS = new Set(['input', 'select', 'textarea', 'img', 'svg', 'canvas', 'iframe']);

/** Raw own visible text (never field values). */
export function rawOwnText(el: Element): string | undefined {
  if (NO_TEXT_TAGS.has(tagOf(el))) return undefined;
  if (isContentEditable(el)) return undefined; // typed content
  let out = '';
  const walk = (node: Node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) out += c.nodeValue ?? '';
      else if (c.nodeType === 1) {
        const ce = c as Element;
        const t = tagOf(ce);
        if (t === 'script' || t === 'style' || t === 'template' || NO_TEXT_TAGS.has(t)) continue;
        if (ce.getAttribute('aria-hidden') === 'true' || ce.hasAttribute('hidden')) continue;
        out += ' ';
        walk(ce);
        out += ' ';
      }
    }
  };
  walk(el);
  const t = cleanText(out);
  return t || undefined;
}

/** Own visible text, omitted if over 80 chars or data-like. */
export function ownText(el: Element): string | undefined {
  return safeLabel(rawOwnText(el));
}

export function isEnabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled === true) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest('fieldset[disabled]') && ['input', 'select', 'textarea', 'button'].includes(tagOf(el))) return false;
  if (el.closest('[inert]')) return false;
  return true;
}

/** Layout-based visibility. Needs a real browser (happy-dom has no layout). */
export function isVisible(el: Element): boolean {
  const anyEl = el as Element & { checkVisibility?: (o?: object) => boolean };
  if (typeof anyEl.checkVisibility === 'function') {
    if (!anyEl.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

export function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/([^\w-])/g, '\\$1').replace(/^(\d)/, '\\3$1 ');
}

/** All open shadow roots under a root, depth first (including nested ones). */
export function openShadowRoots(root: Document | ShadowRoot, limit = 200): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  const visit = (r: Document | ShadowRoot) => {
    const all = r.querySelectorAll('*');
    for (const el of Array.from(all)) {
      const sr = el.shadowRoot;
      if (sr && out.length < limit) {
        out.push(sr);
        visit(sr);
      }
    }
  };
  visit(root);
  return out;
}

/** Elements in tree order for a root (document order within that tree). */
export function compareDocumentOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}
