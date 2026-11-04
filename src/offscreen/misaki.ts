/**
 * The phonemizer for the HD voice: the misaki lexicon (Apache-2.0), downloaded with the model
 * and read from the cache, with Waymark's G2P (D47). No eSpeak NG, so no GPL code ships.
 */
import { G2P, type LexEntry } from '../core/voice/g2p';
import { HD_CACHE, HD_LEXICON_URLS } from '../core/voice/hd';
import type { Phonemizer } from './kokoro';

export async function loadMisaki(): Promise<Phonemizer> {
  const cache = await caches.open(HD_CACHE);
  const [gold, silver] = await Promise.all(
    HD_LEXICON_URLS.map(async (url) => {
      const res = await cache.match(url);
      if (!res) throw new Error('HD voice lexicon is not downloaded');
      return (await res.json()) as Record<string, LexEntry>;
    }),
  );
  const own = Object.prototype.hasOwnProperty;
  const g2p = new G2P({
    get: (w) => (own.call(gold, w) ? gold![w] : own.call(silver, w) ? silver![w] : undefined),
  });
  return async (text) => g2p.phonemize(text).phonemes;
}
