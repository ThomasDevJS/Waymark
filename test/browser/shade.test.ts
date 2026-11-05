/**
 * The highlight shade on the page (D144, D147), in a real browser with the overlay's root open
 * and closed: the dim's colour follows the resolved level, on light and dark schemes; the ring and
 * the hole don't change; forced colours still drop the dim; a new level applies without a redraw.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';
import { PlayerUI } from '../../src/content/player/ui';
import { NO_RUN, type RunView } from '../../src/core/player/run';
import { destroyOverlay, overlayRoot } from '../../src/content/overlay/host';
import { buildFingerprint } from '../../src/core/fingerprint';
import type { Step } from '../../src/core/model/schema';
import { SHADES, type Shade } from '../../src/core/player/shade';

const noop = () => undefined;
const handlers = { next: noop, back: noop, skip: noop, exit: noop, retry: noop, report: noop, goBack: noop, mute: noop, replayVoice: noop, repeat: noop };
let target: HTMLButtonElement;
let ui: PlayerUI;

const step = (el: Element): Step => ({ id: 's', kind: 'click', title: 'Click Save', url: { kind: 'pattern', value: '/' }, advance: 'action', target: buildFingerprint(el) });
const view = (shade?: unknown): RunView => ({ ...NO_RUN, active: true, status: 'running', guideId: 'G', runId: 'R1', guideTitle: 'Demo', stepIndex: 0, total: 2, step: step(target), stepToken: 'T0', ...(shade === undefined ? {} : { shade: shade as Shade }) });

async function media(features: { name: string; value: string }[]) {
  await cdp().send('Emulation.setEmulatedMedia', { features });
  for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
}
const spot = () => overlayRoot().querySelector('.spot') as HTMLElement;
const ring = () => overlayRoot().querySelector('.ring') as HTMLElement;
const token = (name: string) => getComputedStyle(overlayRoot().querySelector('.wm-theme')!).getPropertyValue(name).trim();
/** The dim's colour, as the browser computed it ("rgba(…) 0px 0px 0px 9999px"). */
const dim = () => getComputedStyle(spot()).boxShadow;
/** The dim's alpha, whether the browser writes rgba(…) or color(srgb … / a) (color-mix). */
const alpha = (css: string) => Number(/\/\s*([\d.]+)\s*\)/.exec(css)?.[1] ?? /rgba\([^)]*,\s*([\d.]+)\)/.exec(css)?.[1] ?? 1);

for (const closed of [false, true]) {
  describe(`highlight shade, ${closed ? 'closed' : 'open'} overlay root (D144)`, () => {
    beforeEach(async () => {
      await media([]);
      destroyOverlay();
      history.replaceState(null, '', closed ? '?waymark-test-closed' : location.pathname);
      target = Object.assign(document.createElement('button'), { textContent: 'Save' });
      target.style.cssText = 'position:absolute;left:60px;top:80px;width:90px;height:32px';
      document.body.append(target);
      ui = new PlayerUI(handlers);
    });
    afterEach(async () => {
      ui.clear();
      target.remove();
      destroyOverlay();
      history.replaceState(null, '', location.pathname);
      await media([]);
    });

    for (const scheme of ['light', 'dark']) {
      it(`levels follow --wm-scrim with a clear step between them (${scheme})`, async () => {
        await media([{ name: 'prefers-color-scheme', value: scheme }]);
        const seen: Record<string, number> = {};
        for (const s of SHADES) {
          ui.showStep(view(s), target);
          expect(spot().dataset.shade).toBe(s);
          seen[s] = alpha(dim());
        }
        // Medium is the scheme's own --wm-scrim (D89's default), whatever its value.
        expect(seen.medium).toBeCloseTo(alpha(token('--wm-scrim')), 2);
        // A visible step each way (review: a fixed Darker was only 0.05 above Medium).
        expect(seen.medium! - seen.lighter!).toBeGreaterThanOrEqual(0.095);
        expect(seen.darker! - seen.medium!).toBeGreaterThanOrEqual(0.095);
        expect(seen.lighter!).toBeGreaterThan(0.1); // never "off"
        expect(seen.darker!).toBeLessThanOrEqual(0.7); // never close to opaque
      });
    }

    it('the ring and the hole are the same at every level', () => {
      const looks: string[] = [];
      for (const s of SHADES) {
        ui.showStep(view(s), target);
        const r = getComputedStyle(ring());
        const h = spot().getBoundingClientRect();
        looks.push(JSON.stringify([r.borderColor, r.borderWidth, r.boxShadow, Math.round(h.left), Math.round(h.top), Math.round(h.width), Math.round(h.height)]));
      }
      expect(new Set(looks).size).toBe(1);
    });

    it('no shade, or one it doesn’t know, is the default', () => {
      ui.showStep(view(), target);
      expect(spot().dataset.shade).toBe('medium');
      ui.showStep(view('pitch-black'), target);
      expect(spot().dataset.shade).toBe('medium');
      expect(alpha(dim())).toBe(alpha(token('--wm-scrim')));
    });

    it('a new level (Settings changed) applies to the drawn step without a redraw', () => {
      ui.showStep(view('lighter'), target);
      const before = spot();
      const light = alpha(dim());
      ui.setShade('darker');
      expect(spot()).toBe(before);
      expect(alpha(dim())).toBeGreaterThan(light);
      ui.setShade(0.99);
      expect(spot().dataset.shade).toBe('medium');
    });

    it('forced colours still drop the dim at every level', async () => {
      await media([{ name: 'forced-colors', value: 'active' }]);
      for (const s of SHADES) {
        ui.showStep(view(s), target);
        expect(dim()).toBe('none');
      }
    });
  });
}
