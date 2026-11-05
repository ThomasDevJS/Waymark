/**
 * D66 (security audit): ids, test ids, `name` and `data-guide-id` that look like data (an email,
 * an amount, a phone number) never enter a fingerprint, its CSS path or its shadow path, so
 * they never reach exported packs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildFingerprint, hostSelector } from '../../src/core/fingerprint';

const EMAIL = 'jane.doe@acme.com';
const host = document.createElement('div');
afterEach(() => host.remove());

describe('data-like attribute values', () => {
  it('stay out of the fingerprint of the target and its ancestors', () => {
    document.body.append(host);
    const row = document.createElement('section');
    row.id = `row-${EMAIL}`;
    row.setAttribute('data-testid', `user-row-${EMAIL}`);
    const button = document.createElement('button');
    button.textContent = 'Edit';
    button.id = EMAIL;
    button.name = EMAIL;
    button.setAttribute('data-guide-id', `edit-${EMAIL}`);
    button.setAttribute('data-testid', `edit-${EMAIL}`);
    row.append(button);
    host.append(row);
    const fp = buildFingerprint(button);
    expect(JSON.stringify(fp)).not.toContain('jane.doe');
    expect(fp.text).toBe('Edit'); // still findable by its text
  });

  it('stay out of a shadow path', () => {
    document.body.append(host);
    const widget = document.createElement('div');
    widget.setAttribute('data-testid', `card-${EMAIL}`);
    host.append(widget);
    const root = widget.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.textContent = 'Open';
    root.append(button);
    expect(JSON.stringify(buildFingerprint(button))).not.toContain('jane.doe');
  });

  it('stay out of CSS path classes, key attributes and anchored ancestors', () => {
    document.body.append(host);
    const form = document.createElement('form');
    form.id = `form-${EMAIL}`; // an anchored ancestor
    const input = document.createElement('input');
    input.className = `field user-${EMAIL}`;
    input.name = EMAIL;
    input.type = 'text';
    input.placeholder = 'Search';
    form.append(input);
    host.append(form);
    const fp = buildFingerprint(input);
    expect(fp.cssPath).toContain('input.field');
    expect(JSON.stringify(fp)).not.toContain('jane.doe');
  });

  it('stay out of an iframe selector (frame paths)', () => {
    document.body.append(host);
    const frame = document.createElement('iframe');
    frame.name = EMAIL;
    frame.id = `frame-${EMAIL}`;
    frame.className = `embed user-${EMAIL}`;
    host.append(frame);
    expect(hostSelector(frame)).not.toContain('jane.doe');
  });

  it('ordinary ids and test ids are kept', () => {
    document.body.append(host);
    const button = document.createElement('button');
    button.textContent = 'Save';
    button.id = 'save-button';
    button.setAttribute('data-testid', 'edit-record-2');
    host.append(button);
    const fp = buildFingerprint(button);
    expect(fp.id).toBe('save-button');
    expect(fp.testId?.value).toBe('edit-record-2');
  });
});
