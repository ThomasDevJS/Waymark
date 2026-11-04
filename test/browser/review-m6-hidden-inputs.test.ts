/**
 * Review M6 (docs/DECISIONS.md, "Review fixes (PR #1)"): custom checkboxes and toggles whose
 * native input is visually hidden are found on an unchanged page, and shown through their
 * visible label. A click on the label still reaches the input, so advancing works.
 */
import { describe, expect, it } from 'vitest';
import { buildFingerprint, resolveTargetFromPath } from '../../src/core/fingerprint';
import { matchOnce } from '../../src/core/matcher';
import { $, host, html, useRoot } from './markup';

useRoot();

const SWITCH_CSS = `<style>
  .switch, .toggle { display: inline-block; position: relative; min-width: 40px; height: 20px; background: #ccc; margin: 4px; }
  .switch input { opacity: 0; width: 0; height: 0; }
</style>`;

describe('M6: custom checkboxes and toggles with a hidden native input', () => {
  it('opacity-0, zero-size input in a wrapping label: found, spotlighted through the label', () => {
    html(`${SWITCH_CSS}<label class="switch"><input type="checkbox"><span class="slider"></span><span>Dark mode</span></label>
          <label class="switch"><input type="checkbox"><span class="slider"></span><span>Compact view</span></label>`);
    const label = $('label.switch');
    const slider = $('.slider', label);
    const input = $<HTMLInputElement>('input', label);
    // Record time: a click on the slider resolves through the label to the input.
    expect(resolveTargetFromPath([slider, label, host(), document.body])?.element).toBe(input);
    const fp = buildFingerprint(input);
    const r = matchOnce(document, fp);
    expect(r).toMatchObject({ status: 'found', element: input, tied: [input], spotlight: label });
    expect(fp.accessibleName).toBe('Dark mode');
    expect(fp.rect.w).toBeGreaterThan(0); // the label's box, not the 0x0 input
    // Advancing: the user clicks the label; the click reaches the input, the tied target.
    let clicked: EventTarget | null = null;
    input.addEventListener('click', (e) => (clicked = e.target), { once: true });
    slider.click();
    expect(clicked).toBe(input);
    expect(input.checked).toBe(true);
  });

  it('display:none input with a styled <label for>: found, spotlighted through the label', () => {
    html(`${SWITCH_CSS}<input type="checkbox" id="notify" style="display:none"><label for="notify" class="toggle">Notifications</label>
          <input type="checkbox" id="beta" style="display:none"><label for="beta" class="toggle">Beta features</label>`);
    const input = $<HTMLInputElement>('#notify');
    const label = $('label[for=notify]');
    expect(resolveTargetFromPath([label, host()])?.element).toBe(input);
    const r = matchOnce(document, buildFingerprint(input));
    expect(r).toMatchObject({ status: 'found', element: input, tied: [input], spotlight: label });
    let clicked: EventTarget | null = null;
    input.addEventListener('click', (e) => (clicked = e.target), { once: true });
    label.click();
    expect(clicked).toBe(input);
    expect(input.checked).toBe(true);
  });

  it('a visible element is its own spotlight', () => {
    html(`<button>Save</button>`);
    const btn = $('button');
    expect(matchOnce(document, buildFingerprint(btn))).toMatchObject({ status: 'found', element: btn, spotlight: btn });
  });

  it('a hidden input whose label is hidden too stays not-found', () => {
    html(`<input type="checkbox" id="x" style="display:none"><label for="x" style="display:none">Hidden option</label>`);
    expect(matchOnce(document, buildFingerprint($('#x'))).status).toBe('not-found');
  });

  it('look-alike toggles: the other toggle is never taken when the recorded one is gone', () => {
    html(`${SWITCH_CSS}<label class="switch"><input type="checkbox"><span class="slider"></span><span>Dark mode</span></label>
          <label class="switch"><input type="checkbox"><span class="slider"></span><span>Compact view</span></label>`);
    const fp = buildFingerprint($('label.switch input'));
    $('label.switch').remove();
    expect(matchOnce(document, fp).status).toBe('not-found');
  });
});
