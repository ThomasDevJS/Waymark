/** Element classes the recorder's merge rules care about (SPEC: Recorder, "Merge rules"). */
import { getRole, tagOf } from '../fingerprint/dom';

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color', 'hidden']);

export function inputType(el: Element): string {
  return (el.getAttribute('type') ?? 'text').toLowerCase();
}

/** Fields the author types into. */
export function isTextField(el: Element): boolean {
  const tag = tagOf(el);
  if (tag === 'textarea') return true;
  if (tag === 'input') return !NON_TEXT_INPUTS.has(inputType(el));
  const ce = el.getAttribute('contenteditable');
  return ce !== null && ce !== 'false';
}

export function isNativeSelect(el: Element): boolean {
  return tagOf(el) === 'select';
}

/** Native checkbox/radio, or an ARIA checkbox, radio or switch (which fire no change event). */
export function isCheckLike(el: Element): boolean {
  if (tagOf(el) === 'input') {
    const t = inputType(el);
    return t === 'checkbox' || t === 'radio';
  }
  const role = getRole(el);
  return role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox' || role === 'menuitemradio';
}

export function isNativeCheck(el: Element): boolean {
  return tagOf(el) === 'input' && (inputType(el) === 'checkbox' || inputType(el) === 'radio');
}

/** Checked state after the action, when it can be read. */
export function checkedState(el: Element): boolean | undefined {
  if (isNativeCheck(el)) return (el as HTMLInputElement).checked;
  const v = el.getAttribute('aria-checked');
  return v === 'true' ? true : v === 'false' ? false : undefined;
}

/** A submit button inside a form. */
export function submitForm(el: Element): HTMLFormElement | null {
  const tag = tagOf(el);
  if (tag === 'button') {
    const type = (el.getAttribute('type') ?? 'submit').toLowerCase();
    return type === 'submit' ? (el as HTMLButtonElement).form : null;
  }
  if (tag === 'input') {
    const t = inputType(el);
    return t === 'submit' || t === 'image' ? (el as HTMLInputElement).form : null;
  }
  return null;
}

/** An option of a custom (non-native) dropdown. */
export function isCustomOption(el: Element): boolean {
  return tagOf(el) !== 'option' && getRole(el) === 'option';
}

/** Password, credit-card (autocomplete="cc-*") and one-time-code fields. */
export function isSensitiveField(el: Element): boolean {
  if (tagOf(el) === 'input' && inputType(el) === 'password') return true;
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
  return ac.some((t) => t.startsWith('cc-') || t === 'one-time-code' || t === 'current-password' || t === 'new-password');
}
