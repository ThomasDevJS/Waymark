/**
 * When to offer the HD voice (D140). Asked once, at the moment it matters: the first time a
 * tutorial or an English guide is about to speak, never at install. Pure: the pages pass in what
 * they read from navigator and chrome.storage.
 */
import type { HdState } from './hd';
import { primaryLang } from './voice';

/** storage.local: set once the offer is answered ("Not now" or Download). Settings keeps the switch. */
export const HD_OFFER_KEY = 'ui:hdOffer';
export type HdOfferAnswer = 'later' | 'download';

/**
 * The device looks capable: at least 4 logical cores and (where the browser tells) 4 GB of memory.
 * D51's speed check passed at 0.8–0.95× real time on 4 vCPUs with 4 threads, and the model takes
 * about 800 MB while it speaks. The speed check after the download still has the last word.
 */
export const HD_MIN_CORES = 4;
export const HD_MIN_MEMORY_GB = 4;

export interface HdOfferInput {
  /** navigator.language: the browser's language. */
  uiLang: string | undefined;
  /** navigator.hardwareConcurrency. */
  cores: number | undefined;
  /** navigator.deviceMemory (Chromium only; rounded, capped). Missing means unknown. */
  memoryGb: number | undefined;
  /** The language of what is about to be read: the guide's lang ("en" for tutorials). */
  contentLang: string;
  hd: HdState;
  /** "Read each step aloud". */
  autoPlay: boolean;
  muted: boolean;
  answered: HdOfferAnswer | undefined;
}

export type HdOfferWhy = 'answered' | 'installed' | 'read-aloud-off' | 'muted' | 'not-english' | 'device' | null;

export function deviceLooksCapable(cores: number | undefined, memoryGb: number | undefined): boolean {
  if (!(typeof cores === 'number' && cores >= HD_MIN_CORES)) return false;
  return memoryGb === undefined || memoryGb >= HD_MIN_MEMORY_GB;
}

function isEnglish(lang: string | undefined): boolean {
  return !!lang && primaryLang(lang) === 'en';
}

/** Why the offer stays hidden, or null when it shows. */
export function hdOfferBlocked(i: HdOfferInput): HdOfferWhy {
  if (i.answered) return 'answered';
  // Any state but off: installed, downloading, too slow (Settings offers Check again) or failed (Try again).
  if (i.hd !== 'off') return 'installed';
  if (!i.autoPlay) return 'read-aloud-off';
  if (i.muted) return 'muted';
  if (!isEnglish(i.uiLang) || !isEnglish(i.contentLang)) return 'not-english';
  if (!deviceLooksCapable(i.cores, i.memoryGb)) return 'device';
  return null;
}

export function shouldOfferHd(i: HdOfferInput): boolean {
  return hdOfferBlocked(i) === null;
}
