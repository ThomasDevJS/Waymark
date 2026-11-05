/**
 * The HD voice offer (D140–D143): one small card, shown on an extension page (the side panel while
 * a guide plays, the Practice page while a tutorial plays), the first time it matters. Never in
 * the on-page overlay: a content script can't ask for the download hosts, and it never gets
 * settings. Playback is never blocked: the usual voice reads while the download runs, and the
 * next step after it is ready uses the HD voice.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { send } from '../core/messaging/client';
import { HD_TOTAL_BYTES, mb, type HdStatus } from '../core/voice/hd';
import { HD_OFFER_KEY, shouldOfferHd, type HdOfferAnswer, type HdOfferInput } from '../core/voice/offer';
import { startHdDownload } from './hdDownload';
import { Icon } from './Icon';

/** The bundled sample (scripts/hd-sample.mjs): about 6 s of the HD voice, 21 KB. */
export const HD_SAMPLE_URL = '/hd-sample.ogg';
/** Test builds only: stands in for navigator's language, cores and memory. */
export const HD_OFFER_TEST_ENV = 'test:hdOfferEnv';
const WATCHED = [HD_OFFER_KEY, 'hdStatus', 'voiceSettings'];

interface Gate {
  input: HdOfferInput;
  status: HdStatus;
}

function answerOf(v: unknown): HdOfferAnswer | undefined {
  return v === 'later' || v === 'download' ? v : undefined;
}

async function readGate(contentLang: string): Promise<Gate> {
  const [status, settings, stored] = await Promise.all([
    send('hd.status', {}),
    send('voice.settings.get', {}),
    chrome.storage.local.get(__WAYMARK_TEST__ ? [HD_OFFER_KEY, HD_OFFER_TEST_ENV] : [HD_OFFER_KEY]),
  ]);
  const nav = navigator as Navigator & { deviceMemory?: number };
  let env: Partial<Pick<HdOfferInput, 'uiLang' | 'cores' | 'memoryGb'>> = {};
  if (__WAYMARK_TEST__ && stored[HD_OFFER_TEST_ENV]) env = stored[HD_OFFER_TEST_ENV] as typeof env;
  const input: HdOfferInput = {
    uiLang: 'uiLang' in env ? env.uiLang : navigator.language,
    cores: 'cores' in env ? env.cores : navigator.hardwareConcurrency,
    memoryGb: 'memoryGb' in env ? env.memoryGb : nav.deviceMemory,
    contentLang,
    hd: status.state,
    autoPlay: settings.autoPlay,
    muted: settings.muted,
    answered: answerOf(stored[HD_OFFER_KEY]),
  };
  return { input, status };
}

function remember(answer: HdOfferAnswer): Promise<void> {
  return chrome.storage.local.set({ [HD_OFFER_KEY]: answer });
}

export interface HdOfferProps {
  /** What is about to be read: the first sentence names it. */
  about: 'tutorials' | 'guides';
  /** The language of what is about to be read ("en" for tutorials, the guide's lang). */
  contentLang: string;
  /** The card closed (Not now, Close, or a cancelled download): put focus somewhere useful. */
  onClosed?: () => void;
}

export function HdOffer({ about, contentLang, onClosed }: HdOfferProps) {
  const [gate, setGate] = useState<Gate | null>(null);
  /** offer: the question. progress: Download was pressed here; the card follows the download. */
  const [phase, setPhase] = useState<'offer' | 'progress' | 'closed'>('offer');
  const [message, setMessage] = useState<string | null>(null);
  const [sampling, setSampling] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      void readGate(contentLang).then(
        (g) => live && setGate(g),
        () => undefined,
      );
    load();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && WATCHED.some((k) => k in changes)) load();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      live = false;
      chrome.storage.onChanged.removeListener(onChange);
      audio.current?.pause();
    };
  }, [contentLang]);

  const close = () => {
    audio.current?.pause();
    setPhase('closed');
    onClosed?.();
  };

  const stopSample = () => {
    audio.current?.pause();
    setSampling(false);
  };

  const playSample = async () => {
    if (sampling) return stopSample();
    // Stop the step being read, so the sample isn't talked over.
    await send('voice.stop', {}).catch(() => undefined);
    const a = (audio.current ??= new Audio(HD_SAMPLE_URL));
    a.currentTime = 0;
    a.onended = () => setSampling(false);
    setSampling(true);
    await a.play().catch(() => {
      setSampling(false);
      setMessage('The sample could not play.');
    });
  };

  const download = async () => {
    stopSample();
    setMessage(null);
    const r = await startHdDownload();
    if (!r.ok) {
      // Refused: the question stays, so the learner can try again or say Not now.
      setMessage(r.message);
      return;
    }
    setPhase('progress');
    setGate((g) => (g ? { ...g, status: r.status } : g));
    await remember('download');
    requestAnimationFrame(() => card.current?.querySelector<HTMLElement>('h2')?.focus());
  };

  const notNow = async () => {
    await remember('later');
    close();
  };

  const cancel = async () => {
    await send('hd.remove', {}).catch(() => undefined);
    close();
  };

  if (!gate || phase === 'closed') return null;
  if (phase === 'offer' && !shouldOfferHd(gate.input)) return null;

  const size = mb(HD_TOTAL_BYTES);
  const st = gate.status;
  if (phase === 'progress') {
    const busy = st.state === 'downloading' || st.state === 'checking';
    const pct = st.total ? Math.floor((st.loaded / st.total) * 100) : 0;
    return (
      <section class="card hd-offer" ref={card} aria-labelledby="hd-offer-title" data-testid="hd-offer" data-state={st.state}>
        <h2 id="hd-offer-title" class="card-title" tabIndex={-1}>
          <Icon name="mic" />
          HD voice
        </h2>
        <p class={`small status-text${st.state === 'ready' ? ' ok' : st.state === 'slow' || st.state === 'error' ? ' warn' : ''}`} role="status" data-testid="hd-offer-status">
          {st.state === 'downloading' && 'Downloading the HD voice. The usual voice reads each step until it’s ready.'}
          {st.state === 'checking' && 'Checking how fast this device speaks…'}
          {st.state === 'ready' && 'The HD voice is on. The next step uses it.'}
          {st.state === 'slow' && 'This device is too slow for the HD voice, so Waymark keeps the usual voice.'}
          {st.state === 'error' && `The download failed: ${st.message ?? 'unknown error'}. You can try again in Settings.`}
          {st.state === 'off' && 'The download was cancelled.'}
        </p>
        {st.state === 'downloading' && (
          <div class="hd-offer-progress">
            <progress max={st.total} value={st.loaded} aria-label="HD voice download" data-testid="hd-offer-progress" />
            <span class="xsmall muted" aria-hidden="true">
              {pct}%
            </span>
          </div>
        )}
        <div class="row">
          {busy ? (
            <button type="button" class="ghost sm" data-testid="hd-offer-cancel" onClick={() => void cancel()}>
              Cancel the download
            </button>
          ) : (
            <button type="button" class="sm" data-testid="hd-offer-close" onClick={close}>
              Close
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section class="card hd-offer" ref={card} aria-labelledby="hd-offer-title" data-testid="hd-offer" data-state="offer">
      <h2 id="hd-offer-title" class="card-title" tabIndex={-1}>
        <Icon name="mic" />
        Try the HD voice
      </h2>
      <p class="small" id="hd-offer-text">
        {about === 'tutorials' ? 'Tutorials' : 'Guides'} sound much better with the HD voice. It runs on your device: one download of about {size}, and after that nothing is sent online.
      </p>
      <div class="row">
        <button type="button" class="sm" data-testid="hd-offer-sample" aria-pressed={sampling} onClick={() => void playSample()}>
          <Icon name={sampling ? 'stop' : 'play'} />
          Listen to a sample
        </button>
        <button type="button" class="primary sm" data-testid="hd-offer-download" aria-describedby="hd-offer-text" onClick={() => void download()}>
          <Icon name="download" />
          Download
        </button>
        <button type="button" class="ghost sm" data-testid="hd-offer-later" onClick={() => void notNow()}>
          Not now
        </button>
      </div>
      <p class="xsmall muted">The usual voice keeps reading meanwhile. You can turn the HD voice on or off at any time in Settings.</p>
      {/* Mounted from the start, so screen readers announce a message when it appears. */}
      <p class="small status-text warn" role="status" data-testid="hd-offer-message">
        {message ?? ''}
      </p>
    </section>
  );
}
