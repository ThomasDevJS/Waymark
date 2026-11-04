/**
 * English text to Kokoro phonemes without eSpeak NG (D47): no GPL code ships in the extension.
 * Words come from the misaki lexicon (Apache-2.0, the dictionaries Kokoro was trained with),
 * downloaded as data with the model. Unknown words go through, in order: word forms (-s, -ed,
 * -ing), CamelCase and compound splits, spelling out acronyms, and last rough letter rules.
 * The output follows misaki's format: words joined by spaces, punctuation kept.
 */
import { numberToWords } from './numbers';
import { letterToSound } from './rules';

export type LexEntry = string | { [tag: string]: string | null };
export interface Lexicon {
  get(word: string): LexEntry | undefined;
}

export interface G2PResult {
  phonemes: string;
  /** Words read with the letter rules: guesses, worth showing in tests and reviews. */
  guessed: string[];
}

const PUNCT_ATTACH = new Set([',', '.', '!', '?', ';', ':', '…']);
const PUNCT_KEEP = new Set([...PUNCT_ATTACH, '—', '"', '(', ')']);

function entry(e: LexEntry | undefined): string | undefined {
  if (e === undefined) return undefined;
  if (typeof e === 'string') return e;
  return e.DEFAULT ?? Object.values(e).find((v): v is string => typeof v === 'string');
}

const LETTER = /^[A-Za-z]$/;

/** Expands what a lexicon can't read: emails, web addresses and common symbols. */
export function normalize(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–]/g, '—')
    .replace(/\.\.\./g, '…')
    .replace(/https?:\/\/([^\s/]+)\S*/gi, (_m, host: string) => host.replace(/^www\./i, ''))
    .replace(/\b([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)\b/g, (_m, user: string, domain: string) => `${user.replace(/[._+-]/g, ' ')} at ${domain.replace(/\./g, ' dot ')}`)
    .replace(/\b([a-z0-9-]+)\.(com|org|net|io|dev|app|co|ai|gov|edu)\b/gi, '$1 dot $2')
    .replace(/\s&\s/g, ' and ')
    .replace(/(\w)\/(\w)/g, '$1 slash $2')
    .replace(/\s\+\s/g, ' plus ')
    .replace(/\s=\s/g, ' equals ')
    .replace(/#(\d)/g, 'number $1')
    .replace(/[\t\n\r]+/g, ' ');
}

const TOKEN = /[$€£]?\d[\d,.:]*(?:st|nd|rd|th|%)?|[A-Za-z][A-Za-z']*(?:-[A-Za-z][A-Za-z']*)*|[.,!?;:—…"()]|\S/g;

export class G2P {
  constructor(private readonly lex: Lexicon) {}

  phonemize(text: string): G2PResult {
    const guessed: string[] = [];
    const words: string[] = [];
    const tokens = normalize(text).match(TOKEN) ?? [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (PUNCT_KEEP.has(t)) {
        words.push(t);
        continue;
      }
      if (/^[$€£]?\d/.test(t)) {
        const spoken = numberToWords(t.replace(/[.,:]+$/, ''));
        const said = spoken ?? t.replace(/\D/g, ' ');
        for (const w of said.match(/[A-Za-z']+/g) ?? []) words.push(this.word(w, guessed));
        if (/[.,:]$/.test(t) && PUNCT_ATTACH.has(t.at(-1)!)) words.push(t.at(-1)!);
        continue;
      }
      if (!/[A-Za-z]/.test(t)) continue; // other symbols are not read
      if (t.toLowerCase() === 'to') {
        // Unstressed "to" is "tə" before a consonant, as in misaki.
        const next = tokens[i + 1];
        const nextPh = next && /^[A-Za-z]/.test(next) ? this.word(next, []) : '';
        words.push(nextPh && !/^[ˈˌ]?[æɑɛɪʌʊiuAIOWYɔəɜ]/.test(nextPh) ? 'tə' : 'tu');
        continue;
      }
      if (t.toLowerCase() === 'the') {
        // "the" before a vowel sound is "ði", else "ðə" (as misaki does).
        const next = tokens[i + 1];
        const nextPh = next && /^[A-Za-z]/.test(next) ? this.word(next, []) : '';
        words.push(/^[ˈˌ]?[æɑɛɪʌʊiuAIOWYɔəɜ]/.test(nextPh) ? 'ði' : 'ðə');
        continue;
      }
      words.push(this.word(t, guessed));
    }
    let out = '';
    for (const w of words) {
      if (!w) continue;
      if (PUNCT_ATTACH.has(w) || w === ')') out = out.trimEnd() + w + ' ';
      else if (w === '(') out += w;
      else out += w + ' ';
    }
    return { phonemes: out.trim(), guessed };
  }

  /** One word (letters, apostrophes and hyphens) to phonemes. */
  word(w: string, guessed: string[]): string {
    if (w.includes('-')) return w.split('-').filter(Boolean).map((p) => this.word(p, guessed)).join(' ');
    if (/^[A-Z]{2,6}('?s)?$/.test(w)) {
      // All capitals: a known acronym ("OK", "API"), a shouted word ("SAVE"), else spelled ("CSV", "PDFs").
      const lower = /[AEIOU]/.test(w) ? entry(this.lex.get(w.toLowerCase())) : undefined;
      const asIs = entry(this.lex.get(w)) ?? lower ?? this.spelled(w);
      if (asIs) return asIs;
    }
    return this.known(w) ?? this.spelled(w) ?? this.guess(w, guessed);
  }

  /** From the lexicon, directly or through a word form, a CamelCase split or a compound. */
  private known(w: string): string | undefined {
    const direct = this.lookup(w);
    if (direct) return direct;
    const camel = w.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g);
    if (camel && camel.length > 1 && camel.join('') === w) {
      const parts = camel.map((p) => this.known(p) ?? this.spelled(p));
      if (parts.every(Boolean)) return joinCompound(parts as string[]);
    }
    return this.compound(w);
  }

  private lookup(w: string): string | undefined {
    const variants = [w, w.toLowerCase(), w[0]!.toUpperCase() + w.slice(1).toLowerCase()];
    for (const v of variants) {
      const p = entry(this.lex.get(v));
      if (p) return p;
    }
    return this.form(w.toLowerCase());
  }

  /** -'s, -s, -es, -ies, -ed, -ied, -ing, with the stem from the lexicon. */
  private form(w: string): string | undefined {
    const stem = (s: string) => entry(this.lex.get(s));
    const tries: [string, (p: string) => string][] = [];
    if (w.endsWith("'s")) tries.push([w.slice(0, -2), plural]);
    if (w.endsWith('ies')) tries.push([w.slice(0, -3) + 'y', plural]);
    if (w.endsWith('es')) tries.push([w.slice(0, -2), plural]);
    if (w.endsWith('s') && !w.endsWith('ss')) tries.push([w.slice(0, -1), plural]);
    if (w.endsWith('ied')) tries.push([w.slice(0, -3) + 'y', past]);
    if (w.endsWith('ed')) {
      tries.push([w.slice(0, -1), past], [w.slice(0, -2), past]);
      if (w.at(-3) === w.at(-4)) tries.push([w.slice(0, -3), past]);
    }
    if (w.endsWith('ing')) {
      tries.push([w.slice(0, -3), ing], [w.slice(0, -3) + 'e', ing]);
      if (w.at(-4) === w.at(-5)) tries.push([w.slice(0, -4), ing]);
    }
    for (const [s, f] of tries) {
      if (s.length < 2) continue;
      const p = stem(s);
      if (p) return f(p);
    }
    return undefined;
  }

  /** Two lexicon words written as one: "dropdown", "Waymark", "Gmail" (a capital letter plus a word). */
  private compound(w: string): string | undefined {
    for (let i = w.length - 2; i >= 1; i--) {
      const a = w.slice(0, i);
      const b = w.slice(i);
      const left = a.length === 1 ? (/[A-Z]/.test(a) ? entry(this.lex.get(a)) : undefined) : a.length >= 3 ? this.lookup(a) : undefined;
      if (!left) continue;
      const right = b.length >= 3 ? this.lookup(b) : undefined;
      if (right) return joinCompound([left, right]);
    }
    return undefined;
  }

  /** Acronyms and codes are spelled out: "CSV", "PDFs", "W2". */
  private spelled(w: string): string | undefined {
    const plain = w.replace(/'?s$/, '');
    const isAcronym = /^[A-Z]{2,6}$/.test(plain) || (/^[A-Za-z]{2,5}$/.test(w) && !/[aeiouy]/i.test(w));
    if (!isAcronym) return undefined;
    const letters = [...plain.toUpperCase()].filter((c) => LETTER.test(c)).map((c) => entry(this.lex.get(c)) ?? '');
    if (letters.some((l) => !l)) return undefined;
    // Stress on the last letter, as in "PDF": pˌi dˌi ˈɛf.
    const spoken = letters.map((l, i) => (i === letters.length - 1 ? l : l.replace('ˈ', 'ˌ'))).join('');
    return plain !== w ? plural(spoken) : spoken;
  }

  private guess(w: string, guessed: string[]): string {
    guessed.push(w);
    return letterToSound(w);
  }
}

/** The second part of a compound gets secondary stress: "wˈAmˌɑɹk". */
function joinCompound(parts: string[]): string {
  return parts.map((p, i) => (i === 0 ? p : p.replace('ˈ', 'ˌ'))).join('');
}

const VOICELESS = 'ptkfθ';
const SIBILANT = 'szʃʒʧʤ';

export function plural(p: string): string {
  const last = p.at(-1) ?? '';
  if (SIBILANT.includes(last)) return p + 'ᵻz';
  if (VOICELESS.includes(last)) return p + 's';
  return p + 'z';
}

export function past(p: string): string {
  const last = p.at(-1) ?? '';
  if (last === 't' || last === 'd') return p + 'ᵻd';
  if ('pkfθʃsʧ'.includes(last)) return p + 't';
  return p + 'd';
}

export function ing(p: string): string {
  return p + 'ɪŋ';
}
