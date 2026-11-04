/**
 * HD voice (D47): an optional neural voice (Kokoro-82M, Apache-2.0) that runs on the device in
 * an offscreen document. Pure policy and constants only; no chrome.* calls here.
 */
import { z } from 'zod';
import { primaryLang } from './voice';

/**
 * The model and the lexicon come from their official hosts (Hugging Face for Kokoro, the misaki
 * repository on GitHub), each pinned to one revision, and every file is checked by SHA-256.
 * The host permissions are requested at opt-in and released when the download ends.
 */
export const HD_HOST_PATTERNS = ['https://huggingface.co/*', 'https://raw.githubusercontent.com/*'] as const;
export const HD_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const HD_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const MISAKI_REVISION = 'fba1236595f2d2bf21d414ba6e57d25256afada3';
export const HD_VOICE = 'af_heart';

export interface HdFile {
  /** Where the engine looks for it (and the cache key). */
  url: string;
  size: number;
  sha256: string;
}

export function hdFileUrl(path: string): string {
  return `https://huggingface.co/${HD_REPO}/resolve/${HD_REVISION}/${path}`;
}

const misakiUrl = (name: string) => `https://raw.githubusercontent.com/hexgrad/misaki/${MISAKI_REVISION}/misaki/data/${name}`;
export const HD_LEXICON_URLS = [misakiUrl('us_gold.json'), misakiUrl('us_silver.json')] as const;

export const HD_FILES: readonly HdFile[] = [
  { url: hdFileUrl('config.json'), size: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
  { url: hdFileUrl('tokenizer.json'), size: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
  { url: hdFileUrl('tokenizer_config.json'), size: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' },
  { url: hdFileUrl('onnx/model_fp16.onnx'), size: 163234740, sha256: 'ba4527a874b42b21e35f468c10d326fdff3c7fc8cac1f85e9eb6c0dfc35c334a' },
  { url: hdFileUrl(`voices/${HD_VOICE}.bin`), size: 522240, sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b' },
  { url: HD_LEXICON_URLS[0], size: 3000469, sha256: 'dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f' },
  { url: HD_LEXICON_URLS[1], size: 3099517, sha256: 'de8f67be911bb6c659187b4a65fd966b6a30e56350e0f790d763210b053ac475' },
];

export const HD_TOTAL_BYTES = HD_FILES.reduce((n, f) => n + f.size, 0);

/** Cache Storage name for the model files (versioned, so a new model never mixes with old files). */
export const HD_CACHE = 'waymark-hd-v1';

export const HdStateSchema = z.enum(['off', 'downloading', 'checking', 'ready', 'slow', 'error']);
export type HdState = z.infer<typeof HdStateSchema>;

export const HdStatusSchema = z.object({
  state: HdStateSchema,
  loaded: z.number().min(0).default(0),
  total: z.number().min(0).default(HD_TOTAL_BYTES),
  /** Generation time ÷ audio length, measured once on this device after the download. */
  rtf: z.number().min(0).optional(),
  message: z.string().max(500).optional(),
});
export type HdStatus = z.infer<typeof HdStatusSchema>;

export const HD_OFF: HdStatus = { state: 'off', loaded: 0, total: HD_TOTAL_BYTES };

/**
 * Slower than this (generation time ÷ audio length) and the device is "too slow": steps would
 * start late even with the next step pre-generated, so the system voice is used instead.
 */
export const HD_MAX_RTF = 1.5;

/** How long a step waits for its HD audio before the system voice reads it instead. */
export const HD_WAIT_MS = 4000;

/** The offscreen document (and its ~800 MB model) is closed after this long without HD speech. */
export const HD_IDLE_MINUTES = 3;

export function tooSlow(generationMs: number, audioSeconds: number): boolean {
  if (!(audioSeconds > 0)) return true;
  return generationMs / (audioSeconds * 1000) > HD_MAX_RTF;
}

/** The model speaks English only (v1 uses one American English voice). */
export function hdSupportsLang(lang: string): boolean {
  return primaryLang(lang) === 'en';
}

/** HD voice reads a guide when the user turned it on, the model is ready and fast enough, and the guide is English. */
export function useHd(status: HdStatus, lang: string): boolean {
  return status.state === 'ready' && hdSupportsLang(lang);
}

/** Kokoro's speed parameter follows the user's speech rate, kept in a range it handles well. */
export function hdSpeed(rate: number): number {
  return Math.min(1.5, Math.max(0.7, rate));
}

export function mb(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}
