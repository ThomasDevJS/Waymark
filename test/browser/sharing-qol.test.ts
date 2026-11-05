/**
 * PR B in a real browser (D104, D106): the tooltip's Replay voice and Repeat step buttons, and the
 * export review's how-to formats with the data-like warning.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { userEvent } from 'vitest/browser';
import { PlayerUI } from '../../src/content/player/ui';
import { NO_RUN, type RunView } from '../../src/core/player/run';
import { destroyOverlay, overlayHost } from '../../src/content/overlay/host';
import { ExportReview } from '../../src/entrypoints/sidepanel/ExportReview';
import type { Guide, Step } from '../../src/core/model/schema';

const note: Step = { id: 'S1', kind: 'note', title: 'Read **this**', note: 'Call 555-123-4567 if stuck', url: { kind: 'prefix', value: '/' }, advance: 'next' };
const view = (extra: Partial<RunView> = {}): RunView => ({ ...NO_RUN, active: true, status: 'running', guideTitle: 'Demo', stepIndex: 0, total: 2, step: note, stepToken: 't', ...extra });
const base = { next() {}, back() {}, skip() {}, exit() {}, retry() {}, report() {}, goBack() {}, mute() {} };
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

afterEach(() => destroyOverlay());

describe('tooltip controls (D106)', () => {
  const btn = (action: string) => overlayHost()!.shadowRoot!.querySelector<HTMLButtonElement>(`.tip [data-action="${action}"]`);

  it('shows Repeat step and Replay voice in the header, labelled, and calls them', async () => {
    const calls: string[] = [];
    const ui = new PlayerUI({ ...base, replayVoice: () => calls.push('voice'), repeat: () => calls.push('repeat') });
    ui.showStep(view(), null);
    await tick();
    expect(btn('repeat')!.getAttribute('aria-label')).toBe('Repeat step');
    expect(btn('replay-voice')!.getAttribute('aria-label')).toBe('Replay voice');
    expect([...overlayHost()!.shadowRoot!.querySelectorAll('.tip .head button')].map((b) => (b as HTMLElement).dataset.action)).toEqual(['repeat', 'replay-voice', 'mute', 'exit']);
    await userEvent.click(btn('replay-voice')!);
    await userEvent.click(btn('repeat')!);
    expect(calls).toEqual(['voice', 'repeat']);
    ui.clear();
  });

  it('Replay voice is disabled and says why while muted', async () => {
    let replays = 0;
    const ui = new PlayerUI({ ...base, replayVoice: () => replays++, repeat() {} });
    ui.showStep(view({ muted: true }), null);
    await tick();
    btn('replay-voice')!.click(); // aria-disabled: Playwright would not press it, a user can
    expect(replays).toBe(0);
    // Still focusable, so the reason can be heard; a press does nothing (review).
    expect(btn('replay-voice')!.disabled).toBe(false);
    expect(btn('replay-voice')!.getAttribute('aria-disabled')).toBe('true');
    expect(btn('replay-voice')!.getAttribute('aria-label')).toBe('Replay voice (voice is muted)');
    ui.clear();
  });

  it('a mute change during the step updates the toggle in place, and the next press unmutes (review of D38)', async () => {
    const sent: boolean[] = [];
    const ui = new PlayerUI({ ...base, mute: (m: boolean) => sent.push(m), replayVoice() {}, repeat() {} });
    ui.showStep(view(), null);
    await tick();
    await userEvent.click(btn('mute')!);
    ui.setMuted(true); // the service worker's new view
    expect(btn('mute')!.getAttribute('aria-pressed')).toBe('true');
    expect(btn('replay-voice')!.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(btn('mute')!);
    expect(sent).toEqual([true, false]);
    ui.setMuted(false);
    expect(btn('replay-voice')!.getAttribute('aria-disabled')).toBe('false');
    ui.clear();
  });

  it('focus returns only for a redraw of the same step, never on a later one (review)', async () => {
    let ui: PlayerUI;
    // Repeat ends on a card (not found), then the next step is drawn.
    // eslint-disable-next-line prefer-const
    ui = new PlayerUI({ ...base, replayVoice() {}, repeat: () => ui.showCard('not-found', view()) });
    ui.showStep(view(), null);
    await tick();
    btn('repeat')!.focus();
    await userEvent.keyboard('{Enter}');
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    ui.showStep(view({ stepIndex: 1, stepToken: 't2' }), null);
    await tick();
    expect(document.activeElement).toBe(field);
    field.remove();
    ui.clear();
  });

  it('Test step highlight (no handlers) has no replay buttons', async () => {
    const ui = new PlayerUI(base);
    ui.showStep(view(), null);
    await tick();
    expect(btn('repeat')).toBeNull();
    expect(btn('replay-voice')).toBeNull();
    ui.clear();
  });

  it('a keyboard user keeps focus on Repeat step when the step is redrawn', async () => {
    let ui: PlayerUI;
    // eslint-disable-next-line prefer-const
    ui = new PlayerUI({ ...base, replayVoice() {}, repeat: () => ui.showStep(view(), null) });
    ui.showStep(view(), null);
    await tick();
    btn('repeat')!.focus();
    await userEvent.keyboard('{Enter}');
    await tick();
    expect(overlayHost()!.shadowRoot!.activeElement).toBe(btn('repeat'));
    ui.clear();
  });
});

describe('export review formats (D104)', () => {
  const guide: Guide = {
    id: 'G1', schemaVersion: 1, revisionId: 'R1', title: 'Pay a bill', lang: 'en', tags: [], appOrigins: ['https://app.test'], startUrl: 'https://app.test/bills',
    matchUrls: [], version: 1, source: 'local', updatedAt: '', steps: [note],
  };
  let root: HTMLElement;
  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it('switches to a how-to: lists only its text, flags data, names the file', async () => {
    root = document.createElement('div');
    document.body.append(root);
    render(h(ExportReview, { guides: [guide], onDone: () => undefined }), root);
    await tick();
    const q = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    expect(root.textContent).toContain('Saved as guides.waymark.json');
    await userEvent.click(q('format-markdown')!);
    expect(root.textContent).toContain('Saved as guides.md');
    expect(root.textContent).toContain('everything the how-to will contain');
    expect(root.textContent).not.toContain('Page'); // no step URLs in a how-to
    expect(q('data-like-warning')!.textContent).toContain('1 item looks like data');
    expect(q('data-like-G1|S1|note')).not.toBeNull();
    // Removing the flagged note clears the warning.
    await userEvent.click(q('remove-G1|S1|note')!);
    expect(q('data-like-warning')).toBeNull();
    await userEvent.click(q('format-html')!);
    expect(root.textContent).toContain('Saved as guides.html');
    expect(q('download-howto')!.textContent).toContain('Download how-to');
  });
});
