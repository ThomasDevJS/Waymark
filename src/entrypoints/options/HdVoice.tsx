/** Settings: the optional HD voice (D47). Opt-in, download with progress, test, remove. */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import { HD_HOST_PATTERNS, HD_OFF, HD_TOTAL_BYTES, mb, type HdStatus } from '../../core/voice/hd';

export const hdStatus = signal<HdStatus>(HD_OFF);
const hdMessage = signal<string | null>(null);
let polling: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  hdStatus.value = await send('hd.status', {});
  const busy = hdStatus.value.state === 'downloading' || hdStatus.value.state === 'checking';
  if (busy && !polling) polling = setInterval(() => void refresh(), 500);
  if (!busy && polling) {
    clearInterval(polling);
    polling = undefined;
  }
}

async function enable() {
  hdMessage.value = null;
  // Ask for the download hosts only now, from this click; they are released when the download ends.
  const before = await Promise.all(HD_HOST_PATTERNS.map((p) => chrome.permissions.contains({ origins: [p] })));
  const ok = await chrome.permissions.request({ origins: [...HD_HOST_PATTERNS] }).catch(() => false);
  if (!ok) {
    hdMessage.value = 'HD voice needs to reach Hugging Face and GitHub once, to download the voice.';
    return;
  }
  const added = HD_HOST_PATTERNS.filter((_, i) => !before[i]);
  hdStatus.value = await send('hd.enable', { added });
  await refresh();
}

async function remove() {
  hdMessage.value = null;
  hdStatus.value = await send('hd.remove', {});
  await refresh();
}

export function HdVoice() {
  useEffect(() => {
    void refresh();
    return () => {
      clearInterval(polling);
      polling = undefined;
    };
  }, []);
  const st = hdStatus.value;
  const size = mb(HD_TOTAL_BYTES);
  return (
    <section class="site" aria-label="HD voice">
      <h2>HD voice (beta)</h2>
      <p class="muted">
        A natural-sounding voice that runs on this device, for English guides. It downloads {size} once (the Kokoro voice model from Hugging Face and its English word list from GitHub)
        and keeps it in the browser. After that, nothing leaves your device. It needs a reasonably fast computer; if yours is too slow, Waymark keeps using the system voice.
      </p>
      <p data-testid="hd-state" role="status">
        {st.state === 'off' && 'Off.'}
        {st.state === 'downloading' && `Downloading… ${mb(st.loaded)} of ${mb(st.total)}`}
        {st.state === 'checking' && 'Checking how fast this device speaks…'}
        {st.state === 'ready' && 'On. English guides use the HD voice.'}
        {st.state === 'slow' && 'This device is too slow for the HD voice, so guides use the system voice.'}
        {st.state === 'error' && `HD voice failed: ${st.message ?? 'unknown error'}`}
      </p>
      {st.state === 'downloading' && <progress data-testid="hd-progress" max={st.total} value={st.loaded} />}
      <div class="row">
        {(st.state === 'off' || st.state === 'error') && (
          <button type="button" class="primary" data-testid="hd-enable" onClick={() => void enable()}>
            {st.state === 'error' ? 'Try again' : `Turn on HD voice (${size} download)`}
          </button>
        )}
        {st.state === 'ready' && (
          <button
            type="button"
            data-testid="hd-test"
            onClick={() => void send('hd.test', {}).then((r) => (hdMessage.value = r.ok ? 'Playing a sample…' : 'The HD voice could not play; the system voice is used.'))}
          >
            Test HD voice
          </button>
        )}
        {st.state !== 'off' && (
          <button type="button" data-testid="hd-remove" onClick={() => void remove()}>
            {st.state === 'downloading' || st.state === 'checking' ? 'Cancel' : 'Remove HD voice'}
          </button>
        )}
        {hdMessage.value && <span role="status">{hdMessage.value}</span>}
      </div>
    </section>
  );
}
