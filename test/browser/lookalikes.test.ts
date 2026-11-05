/** D64: a unique match must beat every look-alike seen at record time (review of D64). */
import { afterEach, describe, expect, it } from 'vitest';
import { buildFingerprint } from '../../src/core/fingerprint';
import { matchOnce } from '../../src/core/matcher';

const host = document.createElement('div');
afterEach(() => host.replaceChildren());

function mount(markup: [string, string, string][]) {
  // [landmark, container id, container style]
  document.body.append(host);
  for (const [landmark, id, style] of markup) {
    const l = document.createElement(landmark);
    const d = document.createElement('div');
    d.id = id;
    d.setAttribute('style', style);
    const input = document.createElement('input');
    input.placeholder = 'Select date';
    input.className = 'd';
    d.append(input);
    l.append(d);
    host.append(l);
  }
}

describe('look-alikes the record-time rule must still see', () => {
  it('a look-alike under 60 at record time that reaches 60 on position at playback is refused', () => {
    mount([
      ['main', 'demo-basic', ''],
      ['aside', 'demo-other', 'margin-top:400px'],
    ]);
    const fp = buildFingerprint(host.querySelector('#demo-basic input')!);
    host.querySelector('main')!.remove();
    (host.querySelector('#demo-other') as HTMLElement).style.marginTop = '0';
    const r = matchOnce(document, fp);
    expect(r.status === 'found' ? r.matched : r.status).toBe('not-found');
  });

  it('a look-alike hidden at record time and shown at playback is refused', () => {
    mount([
      ['main', 'demo-basic', ''],
      ['main', 'demo-other', 'display:none'],
    ]);
    const fp = buildFingerprint(host.querySelector('#demo-basic input')!);
    host.querySelector('#demo-basic')!.closest('main')!.remove();
    (host.querySelector('#demo-other') as HTMLElement).style.display = '';
    const r = matchOnce(document, fp);
    expect(r.status === 'found' ? r.matched : r.status).toBe('not-found');
  });

  it('a hidden exact twin (a second demo kept mounted) does not block the target (MUI)', () => {
    mount([
      ['main', 'demo', ''],
      ['main', 'demo', 'display:none'], // same id, same everything: only visibility differs
    ]);
    const el = host.querySelector('main input')!;
    const fp = buildFingerprint(el);
    const r = matchOnce(document, fp);
    expect(r.status === 'found' && r.element).toBe(el);
  });

  it('the target itself is still found when nothing changed', () => {
    mount([
      ['main', 'demo-basic', ''],
      ['main', 'demo-other', 'display:none'],
    ]);
    const el = host.querySelector('#demo-basic input')!;
    const r = matchOnce(document, buildFingerprint(el));
    expect(r.status === 'found' && r.element).toBe(el);
  });
});
