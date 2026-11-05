/**
 * Kokoro-82M (Apache-2.0) through transformers.js and onnxruntime-web, all bundled in the
 * extension (D47). The model files are downloaded once from the official repository at a pinned
 * revision, checked against their SHA-256, and kept in Cache Storage; loading never uses the
 * network. The steps that turn phonemes into audio follow kokoro-js (Apache-2.0).
 */
import { AutoTokenizer, StyleTextToSpeech2Model, Tensor, env, type PreTrainedTokenizer } from '@huggingface/transformers';
import { HD_CACHE, HD_FILES, HD_REPO, HD_REVISION, HD_VOICE, HD_TOTAL_BYTES, hdFileUrl } from '../core/voice/hd';
import type { Audio, HdEngine } from './engine';
import { splitSentences } from './text';

/** Text (one sentence or a few) to phonemes in the form Kokoro was trained on. */
export type Phonemizer = (text: string) => Promise<string>;

// Set at once on import: ONNX Runtime must never fall back to its default CDN location for the
// WebAssembly. load() sets the real extension path before any session exists (D47).
env.backends.onnx.wasm!.wasmPaths = '/ort/';

const SAMPLE_RATE = 24000;
const STYLE_DIM = 256;

const fileName = (url: string) => url.slice(url.lastIndexOf('/') + 1);

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class KokoroEngine implements HdEngine {
  private model: StyleTextToSpeech2Model | null = null;
  private tokenizer: PreTrainedTokenizer | null = null;
  private style: Float32Array | null = null;
  private phonemize: Phonemizer | null = null;

  constructor(
    private readonly loadPhonemizer: () => Promise<Phonemizer>,
    private readonly wasmBase: string,
  ) {}

  async download(onProgress: (loaded: number, total: number) => void): Promise<void> {
    const cache = await caches.open(HD_CACHE);
    let done = 0;
    for (const f of HD_FILES) {
      const { url } = f;
      const have = await cache.match(url);
      if (have) {
        done += f.size;
        onProgress(done, HD_TOTAL_BYTES);
        continue;
      }
      const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${fileName(url)}`);
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        parts.push(value);
        got += value.byteLength;
        if (got > f.size) throw new Error(`${fileName(url)} is larger than expected`);
        onProgress(done + got, HD_TOTAL_BYTES);
      }
      const blob = new Blob(parts as BlobPart[]);
      parts.length = 0; // the Blob holds the bytes now; free the chunks before hashing
      const buf = await blob.arrayBuffer();
      if ((await sha256(buf)) !== f.sha256) throw new Error(`${fileName(url)} failed its integrity check`);
      await cache.put(url, new Response(blob, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(f.size) } }));
      done += f.size;
      onProgress(done, HD_TOTAL_BYTES);
    }
  }

  async load(): Promise<void> {
    if (this.model) return;
    const cache = await caches.open(HD_CACHE);
    for (const f of HD_FILES) if (!(await cache.match(f.url))) throw new Error('HD voice is not downloaded');
    // Everything comes from our cache or from the extension; transformers.js may not fetch.
    // transformers.js reads its cache first; a miss falls to a local path that doesn't exist,
    // never to the network (it refuses to run with both local and remote models off).
    env.allowLocalModels = true;
    env.localModelPath = '/hd-model-not-bundled/';
    env.allowRemoteModels = false;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = {
      match: (req: string | Request) => cache.match(req),
      put: async () => undefined,
    };
    const wasm = env.backends.onnx.wasm!;
    wasm.wasmPaths = this.wasmBase;
    wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
    wasm.proxy = false;
    const [model, tokenizer, voice, phonemize] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(HD_REPO, { revision: HD_REVISION, dtype: 'fp16', device: 'wasm' }),
      AutoTokenizer.from_pretrained(HD_REPO, { revision: HD_REVISION }),
      cache.match(hdFileUrl(`voices/${HD_VOICE}.bin`)).then((r) => r!.arrayBuffer()),
      this.loadPhonemizer(),
    ]);
    this.model = model;
    this.tokenizer = tokenizer;
    this.style = new Float32Array(voice);
    this.phonemize = phonemize;
  }

  async synth(text: string, speed: number): Promise<Audio> {
    await this.load();
    const parts: Float32Array[] = [];
    for (const sentence of splitSentences(text)) parts.push(await this.sentence(sentence, speed));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const samples = new Float32Array(total);
    let at = 0;
    for (const p of parts) {
      samples.set(p, at);
      at += p.length;
    }
    return { samples, sampleRate: SAMPLE_RATE };
  }

  private async sentence(text: string, speed: number): Promise<Float32Array> {
    const phonemes = await this.phonemize!(text);
    if (!phonemes.trim()) return new Float32Array(0);
    const { input_ids } = this.tokenizer!(phonemes, { truncation: true }) as { input_ids: Tensor };
    const tokens = input_ids.dims.at(-1)! - 2;
    const at = STYLE_DIM * Math.min(Math.max(tokens, 0), 509);
    const style = this.style!.slice(at, at + STYLE_DIM);
    const out = (await this.model!({
      input_ids,
      style: new Tensor('float32', style, [1, STYLE_DIM]),
      speed: new Tensor('float32', [speed], [1]),
    })) as { waveform: Tensor };
    const wave = out.waveform.data as Float32Array;
    // fp16 inference can produce the odd NaN; play silence there rather than noise.
    for (let i = 0; i < wave.length; i++) if (!Number.isFinite(wave[i])) wave[i] = 0;
    return wave;
  }

  async remove(): Promise<void> {
    this.model = null;
    this.tokenizer = null;
    this.style = null;
    await caches.delete(HD_CACHE);
  }
}
