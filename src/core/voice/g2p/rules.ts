/**
 * Last-resort letter-to-sound rules for words the lexicon does not know (names such as
 * "Jira"), in misaki's phoneme alphabet (A = eɪ, I = aɪ, O = oʊ, W = aʊ, Y = ɔɪ). Written for
 * Waymark (D47); a rough guess, used only after the lexicon, word forms, compounds and spelling.
 */
const VOWELS = 'aeiouy';
const isVowel = (c: string | undefined) => !!c && VOWELS.includes(c);
const isCons = (c: string | undefined) => !!c && /[a-z]/.test(c) && !VOWELS.includes(c);

interface Rule {
  g: string;
  p: string;
  /** Extra condition on the word and the index where `g` starts. */
  when?: (w: string, i: number) => boolean;
}

const atStart = (w: string, i: number) => i === 0;
const atEnd = (g: string) => (w: string, i: number) => i + g.length === w.length;
/** A vowel, one consonant, then a final silent e: "make", "time", "home". */
const magicE = (w: string, i: number) => isCons(w[i + 1]) && w[i + 2] === 'e' && i + 3 === w.length && w.length > 3;
const softNext = (w: string, i: number) => 'eiy'.includes(w[i + 1] ?? '_');

// Longest graphemes first; the first rule that fits wins.
const RULES: Rule[] = [
  { g: 'tion', p: 'ʃən' },
  { g: 'sion', p: 'ʒən' },
  { g: 'ture', p: 'ʧəɹ' },
  { g: 'ough', p: 'O' },
  { g: 'eigh', p: 'A' },
  { g: 'igh', p: 'I' },
  { g: 'tch', p: 'ʧ' },
  { g: 'dge', p: 'ʤ' },
  { g: 'sch', p: 'sk' },
  { g: 'ing', p: 'ɪŋ', when: atEnd('ing') },
  { g: 'ble', p: 'bᵊl', when: atEnd('ble') },
  { g: 'ple', p: 'pᵊl', when: atEnd('ple') },
  { g: 'tle', p: 'tᵊl', when: atEnd('tle') },
  { g: 'kn', p: 'n', when: atStart },
  { g: 'wr', p: 'ɹ', when: atStart },
  { g: 'ps', p: 's', when: atStart },
  { g: 'ch', p: 'ʧ' },
  { g: 'sh', p: 'ʃ' },
  { g: 'th', p: 'θ' },
  { g: 'ph', p: 'f' },
  { g: 'wh', p: 'w' },
  { g: 'ck', p: 'k' },
  { g: 'ng', p: 'ŋ' },
  { g: 'qu', p: 'kw' },
  { g: 'gh', p: '' },
  { g: 'ee', p: 'i' },
  { g: 'ea', p: 'i' },
  { g: 'oo', p: 'u' },
  { g: 'ai', p: 'A' },
  { g: 'ay', p: 'A' },
  { g: 'ey', p: 'A', when: atEnd('ey') },
  { g: 'ei', p: 'A' },
  { g: 'oa', p: 'O' },
  { g: 'ow', p: 'O', when: atEnd('ow') },
  { g: 'ow', p: 'W' },
  { g: 'ou', p: 'W' },
  { g: 'oi', p: 'Y' },
  { g: 'oy', p: 'Y' },
  { g: 'au', p: 'ɔ' },
  { g: 'aw', p: 'ɔ' },
  { g: 'ie', p: 'i' },
  { g: 'ue', p: 'u' },
  { g: 'ew', p: 'u' },
  { g: 'ar', p: 'ɑɹ', when: (w, i) => !isVowel(w[i + 2]) },
  { g: 'or', p: 'ɔɹ', when: (w, i) => !isVowel(w[i + 2]) },
  { g: 'er', p: 'əɹ', when: (w, i) => i > 0 && !isVowel(w[i + 2]) },
  { g: 'er', p: 'ɜɹ', when: (w, i) => !isVowel(w[i + 2]) },
  { g: 'ir', p: 'ɜɹ', when: (w, i) => !isVowel(w[i + 2]) },
  { g: 'ur', p: 'ɜɹ', when: (w, i) => !isVowel(w[i + 2]) },
  { g: 'a', p: 'A', when: magicE },
  { g: 'i', p: 'I', when: magicE },
  { g: 'o', p: 'O', when: magicE },
  { g: 'u', p: 'u', when: magicE },
  { g: 'e', p: 'i', when: magicE },
  { g: 'e', p: '', when: (w, i) => i === w.length - 1 && w.length > 2 && !w.slice(0, -1).split('').every((c) => !isVowel(c)) },
  { g: 'y', p: 'j', when: (w, i) => i === 0 && isVowel(w[1]) },
  { g: 'y', p: 'I', when: (w, i) => i === w.length - 1 && !/[aeiou]/.test(w.slice(0, -1)) },
  { g: 'y', p: 'i', when: atEnd('y') },
  { g: 'y', p: 'ɪ' },
  { g: 'a', p: 'ə', when: atEnd('a') },
  { g: 'o', p: 'O', when: atEnd('o') },
  { g: 'i', p: 'i', when: atEnd('i') },
  { g: 'a', p: 'æ' },
  { g: 'e', p: 'ɛ' },
  { g: 'i', p: 'ɪ' },
  { g: 'o', p: 'ɑ' },
  { g: 'u', p: 'ʌ' },
  { g: 'c', p: 's', when: softNext },
  { g: 'c', p: 'k' },
  { g: 'g', p: 'ʤ', when: (w, i) => w[i + 1] === 'e' && i + 2 === w.length },
  { g: 'g', p: 'ɡ' },
  { g: 'j', p: 'ʤ' },
  { g: 'x', p: 'z', when: atStart },
  { g: 'x', p: 'ks' },
  { g: 'r', p: 'ɹ' },
  { g: 's', p: 'z', when: (w, i) => i === w.length - 1 && i > 1 && /[aeioubdgvmnlr]/.test(w[i - 1]!) },
];
for (const c of 'bdfhklmnpstvwz') RULES.push({ g: c, p: c });

/** Primary stress goes before the first vowel sound, as in misaki ("klˈɪk"). */
const VOWEL_SOUND = /[æɑɛɪʌʊiuAIOWYɔəɜ]/;

/** Rough phonemes for a lower-case a–z word. Double letters read once ("ll", "tt"). */
export function letterToSound(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  let out = '';
  for (let i = 0; i < w.length; ) {
    if (i > 0 && w[i] === w[i - 1] && isCons(w[i]) && w[i] !== 'c') {
      i++;
      continue;
    }
    const rule = RULES.find((r) => w.startsWith(r.g, i) && (!r.when || r.when(w, i)));
    if (!rule) {
      i++;
      continue;
    }
    out += rule.p;
    i += rule.g.length;
  }
  const v = VOWEL_SOUND.exec(out);
  return v ? out.slice(0, v.index) + 'ˈ' + out.slice(v.index) : out;
}
