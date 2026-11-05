/**
 * On-page player motion (D133) in a real browser, with the overlay's shadow root open (test
 * builds) and closed (the store build, `waymark-test-closed`): the ring glides between targets
 * while the hole is at the new target at once; a closed guide's tooltip leaves as an inert copy; the
 * progress fill eases; a press on the target draws a ripple that never takes the click; reduced
 * motion turns all of it off; focus and announcements are unchanged.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { PlayerUI } from '../../src/content/player/ui';
import { NO_RUN, type RunView } from '../../src/core/player/run';
import { destroyOverlay, overlayHost, overlayRoot } from '../../src/content/overlay/host';
import { buildFingerprint } from '../../src/core/fingerprint';
import type { Step } from '../../src/core/model/schema';

const noop = () => undefined;
const handlers = { next: noop, back: noop, skip: noop, exit: noop, retry: noop, report: noop, goBack: noop, mute: noop, replayVoice: noop, repeat: noop };
let a: HTMLButtonElement;
let b: HTMLButtonElement;
let field: HTMLInputElement;
let ui: PlayerUI;

const step = (el: Element, title: string, advance: Step['advance'] = 'action'): Step => ({ id: title, kind: 'click', title, url: { kind: 'pattern', value: '/' }, advance, target: buildFingerprint(el) });
const view = (s: Step, i: number, extra: Partial<RunView> = {}): RunView => ({ ...NO_RUN, active: true, status: 'running', guideId: 'G', runId: 'R1', guideTitle: 'Demo', stepIndex: i, total: 4, step: s, stepToken: `T${i}`, ...extra });

async function setReduced(on: boolean): Promise<void> {
  await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
  // The page hears the change (the media query's change event) at its next rendering step.
  for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const root = () => overlayRoot();
const ring = () => root().querySelector('.ring') as HTMLElement;
const box = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
};
const finishAll = () => root().querySelectorAll('*').forEach((n) => n.getAnimations().forEach((x) => x.finish()));

for (const closed of [false, true]) {
  describe(`player motion, ${closed ? 'closed' : 'open'} overlay root (D133)`, () => {
    beforeEach(async () => {
      await setReduced(false);
      destroyOverlay();
      history.replaceState(null, '', closed ? '?waymark-test-closed' : location.pathname);
      document.body.style.margin = '0';
      a = Object.assign(document.createElement('button'), { textContent: 'Import' });
      b = Object.assign(document.createElement('button'), { textContent: 'Export orders' });
      field = Object.assign(document.createElement('input'), { placeholder: 'Name' });
      a.style.cssText = 'position:absolute;left:40px;top:60px;width:80px;height:30px';
      b.style.cssText = 'position:absolute;left:400px;top:300px;width:160px;height:40px';
      field.style.cssText = 'position:absolute;left:40px;top:500px';
      document.body.append(a, b, field);
      ui = new PlayerUI(handlers);
    });
    afterEach(async () => {
      ui.clear();
      destroyOverlay();
      a.remove();
      b.remove();
      field.remove();
      history.replaceState(null, '', location.pathname);
      await setReduced(false);
    });

    it('uses the root it was asked for', () => {
      ui.showStep(view(step(a, 'Click Import'), 0), a);
      expect(overlayHost()!.shadowRoot).toBe(closed ? null : root());
    });

    it('the ring glides from the last target; the hole is at the new target at once', async () => {
      ui.showStep(view(step(a, 'Click Import'), 0), a);
      finishAll();
      ui.showStep(view(step(b, 'Click Export'), 1), b);
      const r = ring();
      expect(r.classList.contains('glide')).toBe(true);
      const anims = r.getAnimations().filter((x) => (x.effect as KeyframeEffect).getKeyframes()[0]!.transform);
      expect(anims).toHaveLength(1);
      const from = String((anims[0]!.effect as KeyframeEffect).getKeyframes()[0]!.transform);
      const [, sx, sy] = /^translate\(-360px, -240px\) scale\(([\d.]+), ([\d.]+)\)$/.exec(from) ?? [];
      expect(Number(sx)).toBeCloseTo(92 / 172, 3); // holes have 6 px of padding
      expect(Number(sy)).toBeCloseTo(42 / 52, 3);
      // The dim's hole is already around the new target: it is never covered while the ring travels.
      const spot = root().querySelector('.spot')!;
      expect(spot.classList.contains('still')).toBe(true);
      expect(box(spot)).toEqual({ x: 394, y: 294, w: 172, h: 52 });
      finishAll();
      expect(box(r)).toEqual(box(spot)); // and the ring lands on it
    });

    it('no glide: first step, a Repeat of the same step, another run, after a card, or long after', async () => {
      ui.showStep(view(step(a, 'A'), 0), a);
      expect(ring().classList.contains('glide')).toBe(false);
      ui.showStep(view(step(a, 'A'), 0), a); // Repeat: same step token
      expect(ring().classList.contains('glide')).toBe(false);
      ui.showStep(view(step(b, 'B'), 1, { runId: 'R2' }), b);
      expect(ring().classList.contains('glide')).toBe(false);
      ui.showCard('not-found', view(step(b, 'B'), 1, { runId: 'R2' }));
      ui.showStep(view(step(a, 'A'), 2, { runId: 'R2' }), a);
      expect(ring().classList.contains('glide')).toBe(false);
      ui.clear(); // the step went (while the next one was searched)...
      const real = performance.now;
      performance.now = () => real.call(performance) + 5000; // ...and the next was found 5 s later
      try {
        ui.showStep(view(step(b, 'B'), 3, { runId: 'R2' }), b);
      } finally {
        performance.now = real;
      }
      expect(ring().classList.contains('glide')).toBe(false);
    });

    it('between steps the new tooltip replaces the old one at once (no copy left fading under it)', () => {
      ui.showStep(view(step(a, 'Click Import', 'next'), 0), a);
      ui.showStep(view(step(b, 'Click Export', 'next'), 1), b);
      expect(root().querySelectorAll('.tip')).toHaveLength(1);
      expect(root().querySelector('.tip-out')).toBeNull();
    });

    it('closing the guide: the tooltip leaves as an inert copy nobody can press, find or hear', async () => {
      ui.showStep(view(step(a, 'Click Import', 'next'), 0), a);
      root().querySelector<HTMLElement>('.tip [data-action="exit"]')!.click();
      ui.clear(); // the run ended
      expect(root().querySelector('.tip')).toBeNull();
      const out = root().querySelector('.tip-out') as HTMLElement;
      expect(out).not.toBeNull();
      expect(out.inert).toBe(true);
      expect(out.getAttribute('aria-hidden')).toBe('true');
      expect(out.getAttribute('role')).toBeNull();
      expect(out.querySelector('[id], [data-action], [data-testid]')).toBeNull();
      expect(getComputedStyle(out).pointerEvents).toBe('none');
      expect(root().querySelectorAll('[role="status"]')).toHaveLength(1); // one announcer, as before
      await tick(250);
      expect(root().querySelector('.tip-out')).toBeNull();
    });

    it('the progress fill eases from the last step', () => {
      ui.showStep(view(step(a, 'A'), 0), a);
      ui.showStep(view(step(b, 'B'), 1), b);
      const bar = root().querySelector('.tip .progress > span') as HTMLElement;
      expect(bar.style.transform).toBe('scaleX(0.5)');
      const [anim] = bar.getAnimations();
      expect((anim!.effect as KeyframeEffect).getKeyframes().map((k) => k.transform)).toEqual(['scaleX(0.25)', 'scaleX(0.5)']);
    });

    it('a press on the target ripples; the click still reaches the target; presses on the tooltip do not ripple', async () => {
      let clicks = 0;
      a.addEventListener('click', () => clicks++);
      ui.showStep(view(step(a, 'Click Import'), 0), a);
      await userEvent.click(a);
      expect(clicks).toBe(1);
      const ripple = root().querySelector('.ripple') as HTMLElement;
      expect(ripple).not.toBeNull();
      expect(getComputedStyle(ripple).pointerEvents).toBe('none');
      expect(ripple.getAttribute('aria-hidden')).toBe('true');
      // Nothing of Waymark's sits over the target: a click at its centre lands on it.
      const r = a.getBoundingClientRect();
      expect(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)).toBe(a);
      await tick(400);
      expect(root().querySelector('.ripple')).toBeNull();
      // A press inside the tooltip (it can sit over the target's surroundings) draws nothing.
      root().querySelector<HTMLElement>('.tip [data-action="mute"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      expect(root().querySelector('.ripple')).toBeNull();
    });

    it('a Next step has no ripple (nothing to click on the page)', async () => {
      ui.showStep(view(step(a, 'Look at Import', 'next'), 0), a);
      await userEvent.click(a);
      expect(root().querySelector('.ripple')).toBeNull();
    });

    it('focus stays in the learner’s field through a glide and the tooltip leaving', async () => {
      field.focus();
      ui.showStep(view(step(a, 'A'), 0), a);
      ui.showStep(view(step(b, 'B'), 1), b);
      expect(document.activeElement).toBe(field);
      await tick(300);
      expect(document.activeElement).toBe(field);
    });

    it('reduced motion: no glide, no leaving copy, no eased fill, no ripple', async () => {
      await setReduced(true);
      ui.showStep(view(step(a, 'A'), 0), a);
      ui.showStep(view(step(b, 'B'), 1), b);
      expect(ring().classList.contains('glide')).toBe(false);
      expect(ring().getAnimations()).toHaveLength(0);
      root().querySelector<HTMLElement>('.tip [data-action="exit"]')!.click();
      ui.clear();
      expect(root().querySelector('.tip-out')).toBeNull();
      ui.showStep(view(step(b, 'B'), 1), b);
      expect((root().querySelector('.tip .progress > span') as HTMLElement).getAnimations()).toHaveLength(0);
      await userEvent.click(b);
      expect(root().querySelector('.ripple')).toBeNull();
      for (const n of Array.from(root().querySelectorAll('*'))) expect(n.getAnimations(), n.className).toHaveLength(0);
    });
  });
}
