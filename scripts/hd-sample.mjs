#!/usr/bin/env node
/**
 * Renders the bundled HD voice sample (D141): one sentence spoken by the same Kokoro-82M model,
 * voice and G2P the extension uses, encoded as a small Opus file in public/hd-sample.ogg.
 * Not part of any build; run it by hand when the sample text, the model or the G2P changes.
 *
 *   node scripts/hd-sample.mjs <dir>
 *
 * <dir> holds the pinned files from HD_FILES (checked by SHA-256 here):
 *   <dir>/model/onnx-community/Kokoro-82M-v1.0-ONNX/{config.json,tokenizer.json,tokenizer_config.json,onnx/model_fp16.onnx,voices/af_heart.bin}
 *   <dir>/lex/{us_gold.json,us_silver.json}
 * Needs ffmpeg (libopus). Runs on onnxruntime-node (a dependency of transformers.js), on the CPU.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// rolldown comes with WXT's Vite; it is not a direct dependency.
const fromWxt = createRequire(createRequire(import.meta.url).resolve('wxt'));
const { build } = await import(pathToFileURL(createRequire(fromWxt.resolve('vite')).resolve('rolldown')).href);

export const SAMPLE_TEXT = 'Welcome to the practice page. Waymark guides you through it one step at a time.';

const dir = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: node scripts/hd-sample.mjs <dir with the model files>');
const root = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'hd-sample-'));

// Bundle the extension's own G2P and file list (TypeScript) for Node.
await build({
  input: { g2p: join(root, 'src/core/voice/g2p/index.ts'), hd: join(root, 'src/core/voice/hd.ts'), text: join(root, 'src/offscreen/text.ts') },
  platform: 'node',
  output: { dir: tmp, format: 'esm', entryFileNames: '[name].mjs' },
  logLevel: 'silent',
});
const { G2P } = await import(pathToFileURL(join(tmp, 'g2p.mjs')).href);
const { HD_FILES, HD_REPO, HD_REVISION, HD_VOICE } = await import(pathToFileURL(join(tmp, 'hd.mjs')).href);
const { splitSentences } = await import(pathToFileURL(join(tmp, 'text.mjs')).href);

const local = (url) => (url.includes('/misaki/') ? join(dir, 'lex', url.slice(url.lastIndexOf('/') + 1)) : join(dir, 'model', HD_REPO, url.split(`/resolve/${HD_REVISION}/`)[1]));
for (const f of HD_FILES) {
  const sum = createHash('sha256').update(readFileSync(local(f.url))).digest('hex');
  if (sum !== f.sha256) throw new Error(`${local(f.url)} does not match its pinned SHA-256`);
}

const lex = HD_FILES.filter((f) => f.url.includes('/misaki/')).map((f) => JSON.parse(readFileSync(local(f.url), 'utf8')));
const own = Object.prototype.hasOwnProperty;
const g2p = new G2P({ get: (w) => lex.find((l) => own.call(l, w))?.[w] });

const { AutoTokenizer, StyleTextToSpeech2Model, Tensor, env } = await import('@huggingface/transformers');
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = join(dir, 'model') + '/';
const model = await StyleTextToSpeech2Model.from_pretrained(HD_REPO, { dtype: 'fp16', device: 'cpu' });
const tokenizer = await AutoTokenizer.from_pretrained(HD_REPO);
const style = new Float32Array(readFileSync(local(HD_FILES.find((f) => f.url.endsWith(`${HD_VOICE}.bin`)).url)).buffer.slice(0));

const parts = [];
for (const sentence of splitSentences(SAMPLE_TEXT)) {
  const { input_ids } = tokenizer(g2p.phonemize(sentence).phonemes, { truncation: true });
  const at = 256 * Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509);
  const out = await model({ input_ids, style: new Tensor('float32', style.slice(at, at + 256), [1, 256]), speed: new Tensor('float32', [1], [1]) });
  const wave = out.waveform.data;
  for (let i = 0; i < wave.length; i++) if (!Number.isFinite(wave[i])) wave[i] = 0;
  parts.push(wave, new Float32Array(24000 * 0.25)); // a short pause between sentences
}
const total = parts.reduce((n, p) => n + p.length, 0);
const pcm = new Int16Array(total);
let i = 0;
for (const p of parts) for (const s of p) pcm[i++] = Math.max(-1, Math.min(1, s)) * 32767;
const raw = join(tmp, 'sample.pcm');
writeFileSync(raw, Buffer.from(pcm.buffer));
const out = join(root, 'public/hd-sample.ogg');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', raw, '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-map_metadata', '-1', out]);
console.log(`${out}: ${(total / 24000).toFixed(1)} s, ${readFileSync(out).length} bytes`);
