/**
 * Launcher motion (D134), in a closed shadow root as in the store build: the ? button pops in and
 * the menu rises in on transform and opacity; under reduced motion nothing animates or transitions.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import { LAUNCHER_CSS } from '../../src/content/launcher';
import { THEME_CSS } from '../../src/content/overlay/theme';

async function setReduced(on: boolean): Promise<void> {
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
  for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
}

let host: HTMLElement | null = null;
function mount(): { button: HTMLElement; card: HTMLElement; item: HTMLElement } {
  host = document.createElement('div');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = THEME_CSS + LAUNCHER_CSS;
  const layer = document.createElement('div');
  layer.className = 'wm-theme';
  const button = document.createElement('button');
  button.className = 'wm-launch';
  const card = document.createElement('div');
  card.className = 'wm-card wm-menu';
  const item = document.createElement('button');
  item.textContent = 'Start guide';
  card.append(item);
  layer.append(button, card);
  root.append(style, layer);
  return { button, card, item };
}
const names = (el: Element) => el.getAnimations().map((a) => (a as CSSAnimation).animationName);
const props = (el: Element) =>
  el.getAnimations().flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p))));

afterEach(async () => {
  host?.remove();
  host = null;
  await setReduced(false);
});

describe('launcher motion (D134)', () => {
  it('the button pops in and the menu rises in, on transform and opacity only', async () => {
    await setReduced(false);
    const { button, card } = mount();
    expect(names(button)).toContain('wm-pop');
    expect(names(card)).toContain('wm-rise');
    for (const p of [...props(button), ...props(card)]) expect(['opacity', 'scale', 'translate']).toContain(p);
    expect(getComputedStyle(button).transitionProperty).toContain('transform');
  });

  it('reduced motion: nothing animates or transitions', async () => {
    await setReduced(true);
    const { button, card, item } = mount();
    for (const el of [button, card, item]) {
      expect(el.getAnimations()).toHaveLength(0);
      expect(getComputedStyle(el).transitionDuration).toBe('0s');
    }
  });
});
