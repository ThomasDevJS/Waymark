/**
 * The HD voice offer card (D140–D143) in a real browser: when it shows, asked once (Not now and
 * Download are remembered), Download asks for the hosts from the click and then follows the
 * download, a refused request keeps the question, and the sample stops the step being read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { userEvent } from 'vitest/browser';
import { HdOffer, HD_OFFER_TEST_ENV } from '../../src/ui/HdOffer';
import { HD_OFFER_KEY } from '../../src/core/voice/offer';
import { HD_HOST_PATTERNS, HD_OFF, HD_TOTAL_BYTES, type HdStatus } from '../../src/core/voice/hd';

let sent: { type: string; payload: Record<string, unknown> }[];
let stored: Record<string, unknown>;
let hd: HdStatus;
let voice: { autoPlay: boolean; muted: boolean };
let granted: boolean;
let listeners: ((c: Record<string, unknown>, area: string) => void)[];
let root: HTMLElement;

function answer(type: string): unknown {
  if (type === 'hd.status') return hd;
  if (type === 'voice.settings.get') return { rate: 1, allowOnlineVoices: false, voices: {}, ...voice };
  if (type === 'hd.enable') return (hd = { ...HD_OFF, state: 'downloading' });
  if (type === 'hd.remove') return (hd = HD_OFF);
  return { ok: true };
}

function setStored(o: Record<string, unknown>) {
  Object.assign(stored, o);
  for (const l of listeners) l(Object.fromEntries(Object.keys(o).map((k) => [k, { newValue: o[k] }])), 'local');
}

beforeEach(() => {
  sent = [];
  listeners = [];
  hd = HD_OFF;
  voice = { autoPlay: true, muted: false };
  granted = true;
  stored = { [HD_OFFER_TEST_ENV]: { uiLang: 'en-US', cores: 8, memoryGb: 8 } };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: async (m: { type: string; payload: Record<string, unknown> }) => {
        sent.push(m);
        return { ok: true, data: answer(m.type) };
      },
    },
    permissions: {
      contains: async () => false,
      request: vi.fn(async () => granted),
    },
    storage: {
      onChanged: { addListener: (l: (typeof listeners)[number]) => listeners.push(l), removeListener() {} },
      local: {
        get: async (k: string | string[]) => Object.fromEntries((Array.isArray(k) ? k : [k]).map((x) => [x, stored[x]])),
        set: async (o: Record<string, unknown>) => setStored(o),
      },
    },
  };
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.restoreAllMocks();
});

const card = () => root.querySelector<HTMLElement>('[data-testid="hd-offer"]');
const btn = (id: string) => root.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
const settle = () => new Promise((r) => setTimeout(r, 30));

async function mount(props: Partial<Parameters<typeof HdOffer>[0]> = {}) {
  render(h(HdOffer, { about: 'tutorials', contentLang: 'en', ...props }), root);
  await settle();
}

describe('when the offer shows', () => {
  it('shows on a capable English browser with HD off and read-aloud on; the copy names the real size', async () => {
    await mount();
    expect(card()).not.toBeNull();
    expect(card()!.textContent).toContain('Tutorials sound much better with the HD voice.');
    expect(card()!.textContent).toContain('about 170 MB');
    expect(card()!.textContent).toContain('nothing is sent online');
    for (const id of ['hd-offer-sample', 'hd-offer-download', 'hd-offer-later']) expect(btn(id)).not.toBeNull();
    // Labelled region with a heading, for screen readers.
    expect(card()!.getAttribute('aria-labelledby')).toBe('hd-offer-title');
  });

  it('guides get their own first sentence', async () => {
    await mount({ about: 'guides' });
    expect(card()!.textContent).toContain('Guides sound much better');
  });

  it('hidden for a non-English browser or guide', async () => {
    stored[HD_OFFER_TEST_ENV] = { uiLang: 'fr-FR', cores: 8, memoryGb: 8 };
    await mount();
    expect(card()).toBeNull();
    render(null, root);
    stored[HD_OFFER_TEST_ENV] = { uiLang: 'en-US', cores: 8, memoryGb: 8 };
    await mount({ contentLang: 'de' });
    expect(card()).toBeNull();
  });

  it('hidden on a device that looks too small', async () => {
    stored[HD_OFFER_TEST_ENV] = { uiLang: 'en-US', cores: 2, memoryGb: 8 };
    await mount();
    expect(card()).toBeNull();
    render(null, root);
    stored[HD_OFFER_TEST_ENV] = { uiLang: 'en-US', cores: 8, memoryGb: 2 };
    await mount();
    expect(card()).toBeNull();
  });

  it('hidden when HD is installed, or read-aloud is off, or muted', async () => {
    hd = { ...HD_OFF, state: 'ready', loaded: HD_TOTAL_BYTES };
    await mount();
    expect(card()).toBeNull();
    render(null, root);
    hd = HD_OFF;
    voice = { autoPlay: false, muted: false };
    await mount();
    expect(card()).toBeNull();
    render(null, root);
    voice = { autoPlay: true, muted: true };
    await mount();
    expect(card()).toBeNull();
  });

  it('hidden once answered, and hides when another page answers it', async () => {
    stored[HD_OFFER_KEY] = 'later';
    await mount();
    expect(card()).toBeNull();
    render(null, root);
    delete stored[HD_OFFER_KEY];
    await mount();
    expect(card()).not.toBeNull();
    // The Practice page and the panel can both show it: an answer in one hides the other.
    setStored({ [HD_OFFER_KEY]: 'download' });
    await settle();
    expect(card()).toBeNull();
  });
});

describe('answering', () => {
  it('Not now is remembered and closes the card; nothing is requested or downloaded', async () => {
    const onClosed = vi.fn();
    await mount({ onClosed });
    await userEvent.click(btn('hd-offer-later'));
    await settle();
    expect(stored[HD_OFFER_KEY]).toBe('later');
    expect(card()).toBeNull();
    expect(onClosed).toHaveBeenCalled();
    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(sent.some((m) => m.type === 'hd.enable')).toBe(false);
  });

  it('Download asks for the two download hosts from the click, starts the shared download and follows it', async () => {
    await mount();
    await userEvent.click(btn('hd-offer-download'));
    await settle();
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: [...HD_HOST_PATTERNS] });
    expect(sent.find((m) => m.type === 'hd.enable')?.payload).toEqual({ added: [...HD_HOST_PATTERNS] });
    expect(stored[HD_OFFER_KEY]).toBe('download');
    expect(card()!.dataset.state).toBe('downloading');
    expect(root.querySelector('[data-testid="hd-offer-status"]')!.textContent).toContain('The usual voice reads each step until it’s ready');
    expect(document.activeElement?.id).toBe('hd-offer-title'); // the pressed button is gone: focus stays in the card
    // The download finishes: the card says the next step uses it.
    hd = { ...HD_OFF, state: 'ready', loaded: HD_TOTAL_BYTES };
    setStored({ hdStatus: hd });
    await settle();
    expect(card()!.dataset.state).toBe('ready');
    expect(root.querySelector('[data-testid="hd-offer-status"]')!.textContent).toBe('The HD voice is on. The next step uses it.');
    await userEvent.click(btn('hd-offer-close'));
    expect(card()).toBeNull();
  });

  it('a refused host request keeps the question and says why; nothing is remembered', async () => {
    granted = false;
    await mount();
    await userEvent.click(btn('hd-offer-download'));
    await settle();
    expect(sent.some((m) => m.type === 'hd.enable')).toBe(false);
    expect(stored[HD_OFFER_KEY]).toBeUndefined();
    expect(card()!.dataset.state).toBe('offer');
    expect(root.querySelector('[data-testid="hd-offer-message"]')!.textContent).toContain('Hugging Face and GitHub');
  });

  it('Cancel the download removes it and closes the card', async () => {
    await mount();
    await userEvent.click(btn('hd-offer-download'));
    await settle();
    await userEvent.click(btn('hd-offer-cancel'));
    await settle();
    expect(sent.some((m) => m.type === 'hd.remove')).toBe(true);
    expect(card()).toBeNull();
  });

  it('Listen to a sample stops the step being read, then plays the bundled file; it never downloads', async () => {
    await mount();
    await userEvent.click(btn('hd-offer-sample'));
    await settle();
    expect(sent.map((m) => m.type)).toContain('voice.stop');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    const audio = vi.mocked(HTMLMediaElement.prototype.play).mock.contexts[0] as HTMLAudioElement;
    expect(new URL(audio.src).pathname).toBe('/hd-sample.ogg');
    expect(btn('hd-offer-sample').getAttribute('aria-pressed')).toBe('true');
    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(sent.some((m) => m.type === 'hd.enable')).toBe(false);
    // Pressing it again stops the sample.
    await userEvent.click(btn('hd-offer-sample'));
    expect(btn('hd-offer-sample').getAttribute('aria-pressed')).toBe('false');
  });
});
