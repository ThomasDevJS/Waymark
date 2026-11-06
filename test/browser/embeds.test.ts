/** D155: the sites of a page's visible child frames (layout needed for "visible"). */
import { afterEach, describe, expect, it } from 'vitest';
import { childFrameOrigins } from '../../src/core/frames/embeds';

const made: Element[] = [];
const frame = (src: string, style = 'width:200px;height:80px') => {
  const f = document.createElement('iframe');
  f.setAttribute('src', src);
  f.setAttribute('style', style);
  made.push(f);
  return f;
};
afterEach(() => {
  for (const e of made.splice(0)) e.remove();
});

describe('childFrameOrigins (D155)', () => {
  it('lists visible child frames of other sites, in open shadow roots too, not srcdoc or the own site', () => {
    const host = document.createElement('div');
    made.push(host);
    host.attachShadow({ mode: 'open' }).append(frame('https://app.example/x'));
    const srcdoc = document.createElement('iframe');
    srcdoc.setAttribute('srcdoc', '<p>x</p>');
    made.push(srcdoc);
    document.body.append(host, frame(`${location.origin}/frame.html`), frame('https://embed.example/inner?q=1'), srcdoc);
    expect(childFrameOrigins(document)).toEqual(['https://app.example', 'https://embed.example']);
  });

  it('leaves out frames a person can’t see, so a page can’t make the panel offer them (review of D155)', () => {
    document.body.append(
      frame('https://mail.example/', 'display:none'),
      frame('https://bank.example/', 'width:0;height:0;border:0'),
      frame('https://ghost.example/', 'visibility:hidden;width:200px;height:80px'),
      frame('https://clear.example/', 'opacity:0;width:200px;height:80px'),
      frame('https://shown.example/'),
    );
    expect(childFrameOrigins(document)).toEqual(['https://shown.example']);
  });
});
