import { describe, expect, it } from 'vitest';
import { escapeMd, parseInline, renderInline, toPlainText } from '../../src/core/text/markdown';
import { chooseOptionTitle, roleWord, stepTitle } from '../../src/core/text/templates';

describe('markdown-lite', () => {
  it('parses bold, italic, breaks and https links only', () => {
    expect(parseInline('Click **Save** now')).toEqual([
      { type: 'text', text: 'Click ' },
      { type: 'bold', children: [{ type: 'text', text: 'Save' }] },
      { type: 'text', text: ' now' },
    ]);
    expect(parseInline('a\nb')[1]).toEqual({ type: 'br' });
    expect(parseInline('[docs](https://x.test/a)')).toEqual([{ type: 'link', text: 'docs', href: 'https://x.test/a' }]);
    expect(parseInline('[bad](javascript:alert(1))')).toEqual([{ type: 'text', text: '[bad](javascript:alert(1))' }]);
    expect(parseInline('[http](http://x.test)')[0]).toEqual({ type: 'text', text: '[http](http://x.test)' });
  });
  it('renders DOM nodes without innerHTML; markup in text stays text', () => {
    const div = document.createElement('div');
    div.append(...renderInline('<img src=x onerror=alert(1)> **bold** [l](https://x.test)'));
    expect(div.querySelector('img')).toBeNull();
    expect(div.querySelector('strong')?.textContent).toBe('bold');
    const a = div.querySelector('a')!;
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
    expect(toPlainText('Click **Save**')).toBe('Click Save');
  });
  it('escapes labels inserted into templates', () => {
    expect(escapeMd('a*b_[c]')).toBe('a\\*b\\_\\[c\\]');
    expect(toPlainText(`Click **${escapeMd('2*3')}**`)).toBe('Click 2*3');
  });
});

describe('templates', () => {
  it('follows the spec table', () => {
    expect(stepTitle('click', { name: 'Save' })).toBe('Click **Save**');
    expect(stepTitle('input', { name: 'Email' })).toBe('Enter Email');
    expect(stepTitle('input', { name: 'Password', sensitive: true })).toBe('Enter your Password');
    expect(stepTitle('select', { name: 'Country', option: 'France' })).toBe('Choose **France** in **Country**');
    expect(stepTitle('check', { name: 'Newsletter', checked: true })).toBe('Check **Newsletter**');
    expect(stepTitle('check', { name: 'Newsletter', checked: false })).toBe('Uncheck **Newsletter**');
    expect(stepTitle('submit', {})).toBe('Submit the form');
    expect(stepTitle('navigate', { pageTitle: 'Orders' })).toBe('Go to Orders');
    expect(stepTitle('click', { name: 'Save' }, 'fr')).toBe('Click **Save**'); // falls back to English
    expect(chooseOptionTitle('Closed')).toBe('Choose **Closed**');
    expect(roleWord('button')).toBe('the button');
    expect(roleWord(undefined)).toBe('the element');
  });
});
