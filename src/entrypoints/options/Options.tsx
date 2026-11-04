import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { send } from '../../core/messaging/client';
import { primaryLang, type VoiceSettings } from '../../core/voice/voice';

const settings = signal<VoiceSettings | null>(null);
const voices = signal<{ voiceName: string; lang: string; remote: boolean }[]>([]);
const available = signal(true);
const lang = signal('en');
const status = signal<string | null>(null);

async function load() {
  settings.value = await send('voice.settings.get', {});
  const v = await send('voice.list', {});
  voices.value = v.voices;
  available.value = v.available;
}

async function update(patch: Partial<VoiceSettings>) {
  settings.value = await send('voice.settings.set', { patch });
  voices.value = (await send('voice.list', {})).voices;
}

export function Options() {
  useEffect(() => void load(), []);
  const s = settings.value;
  if (!s) return <main />;
  const forLang = voices.value.filter((v) => primaryLang(v.lang) === lang.value);
  const langs = [...new Set(['en', ...voices.value.map((v) => primaryLang(v.lang))])].sort();
  return (
    <main>
      <h1>Waymark settings</h1>
      <section class="site" aria-label="Voice">
        <h2>Voice</h2>
        {!available.value && <p role="status">This browser has no extension voice API. Guides will be read with the page's speech engine where possible.</p>}
        <label class="row">
          <input type="checkbox" data-testid="autoplay" checked={s.autoPlay} onChange={(e) => void update({ autoPlay: (e.target as HTMLInputElement).checked })} />
          Read each step aloud when it appears
        </label>
        <label class="grow">
          <span class="muted">Language</span>
          <select value={lang.value} onChange={(e) => (lang.value = (e.target as HTMLSelectElement).value)}>
            {langs.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label class="grow">
          <span class="muted">Voice for “{lang.value}” guides</span>
          <select
            data-testid="voice"
            value={s.voices[lang.value] ?? ''}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              const next = { ...s.voices };
              if (v) next[lang.value] = v;
              else delete next[lang.value];
              void update({ voices: next });
            }}
          >
            <option value="">Automatic (first on-device voice)</option>
            {forLang.map((v) => (
              <option key={v.voiceName} value={v.voiceName}>
                {v.voiceName}
                {v.remote ? ' (online)' : ''}
              </option>
            ))}
          </select>
        </label>
        {forLang.length === 0 && <p class="muted">No on-device voice for this language: guides stay silent; their text still shows.</p>}
        <label class="grow">
          <span class="muted">Speed: {s.rate.toFixed(1)}×</span>
          <input type="range" min="0.5" max="2" step="0.1" value={s.rate} onChange={(e) => void update({ rate: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="row">
          <input type="checkbox" data-testid="online" checked={s.allowOnlineVoices} onChange={(e) => void update({ allowOnlineVoices: (e.target as HTMLInputElement).checked })} />
          Allow online voices
        </label>
        <p class="muted">Online voices (such as Chrome's “Google …” voices) send the step text to the voice provider. They are off by default.</p>
        <div class="row">
          <button
            type="button"
            data-testid="test-voice"
            onClick={() =>
              void send('voice.test', { lang: lang.value }).then((r) => (status.value = r.ok ? 'Playing a sample…' : 'No usable voice for this language.'))
            }
          >
            Test voice
          </button>
          {status.value && <span role="status">{status.value}</span>}
        </div>
      </section>
    </main>
  );
}
