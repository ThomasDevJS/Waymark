/**
 * The GPL-free English G2P for the HD voice (D47). The lexicon here is a handful of entries
 * copied from misaki's us_gold.json / us_silver.json (Apache-2.0, hexgrad/misaki).
 */
import { describe, expect, it } from 'vitest';
import { G2P, normalize, past, plural, type LexEntry } from '../../src/core/voice/g2p';
import { cardinal, numberToWords, ordinal, year } from '../../src/core/voice/g2p/numbers';
import { letterToSound } from '../../src/core/voice/g2p/rules';

const LEX: Record<string, LexEntry> = {
  click: 'klˈɪk',
  save: 'sˈAv',
  store: 'stˈɔɹ',
  invoice: 'ˈɪnvˌYs',
  then: 'ðˈɛn',
  open: 'ˈOpᵊn',
  orders: 'ˈɔɹdəɹz',
  page: 'pˈAʤ',
  export: 'ˈɛkspˌɔɹt',
  drop: 'dɹˈɑp',
  down: 'dˈWn',
  way: 'wˈA',
  mark: 'mˈɑɹk',
  mail: 'mˈAl',
  quick: 'kwˈɪk',
  books: 'bˈʊks',
  box: 'bˈɑks',
  stop: 'stˈɑp',
  upload: 'ˈʌplˌOd',
  read: { DEFAULT: 'ɹˈid', VBD: 'ɹˈɛd' },
  new: 'nˈu',
  api: 'ˈæpi',
  OK: 'ˌOkˈA',
  at: 'æt',
  dot: 'dˈɑt',
  com: 'kˈɑm',
  support: 'səpˈɔɹt',
  acme: 'ˈækmi',
  corp: 'kˈɔɹp',
  example: 'ɪɡzˈæmpəl',
  visit: 'vˈɪzət',
  now: 'nˈW',
  one: 'wˈʌn',
  two: 'tˈu',
  three: 'θɹˈi',
  thousand: 'θˈWzᵊnd',
  hundred: 'hˈʌndɹəd',
  fifty: 'fˈɪfti',
  point: 'pˈYnt',
  seven: 'sˈɛvən',
  five: 'fˈIv',
  dollars: 'dˈɑləɹz',
  C: 'sˈi',
  S: 'ˈɛs',
  V: 'vˈi',
  P: 'pˈi',
  D: 'dˈi',
  F: 'ˈɛf',
  G: 'ʤˈi',
};
const g2p = new G2P({ get: (w) => (Object.hasOwn(LEX, w) ? LEX[w] : undefined) });
const say = (t: string) => g2p.phonemize(t);

describe('G2P', () => {
  it('reads lexicon words, in any case, with punctuation kept as misaki writes it', () => {
    expect(say('Click Save to store the invoice, then open the Orders page.').phonemes).toBe('klˈɪk sˈAv tə stˈɔɹ ði ˈɪnvˌYs, ðˈɛn ˈOpᵊn ði ˈɔɹdəɹz pˈAʤ.');
    expect(say('Click Save').guessed).toEqual([]);
  });
  it('"the" and "to" take their weak forms by the next sound', () => {
    expect(say('the invoice').phonemes).toBe('ði ˈɪnvˌYs');
    expect(say('the page').phonemes).toBe('ðə pˈAʤ');
    expect(say('to upload').phonemes).toBe('tu ˈʌplˌOd');
  });
  it('uses the DEFAULT of a tagged entry', () => {
    expect(say('read').phonemes).toBe('ɹˈid');
  });
  it('builds word forms from a known stem: -s, -es, -ed, -ing', () => {
    expect(say('clicks').phonemes).toBe('klˈɪks');
    expect(say('boxes').phonemes).toBe('bˈɑksᵻz');
    expect(say('clicked').phonemes).toBe('klˈɪkt');
    expect(say('saved').phonemes).toBe('sˈAvd');
    expect(say('stopped').phonemes).toBe('stˈɑpt');
    expect(say('saving').phonemes).toBe('sˈAvɪŋ');
    expect(say('stopping').phonemes).toBe('stˈɑpɪŋ');
    expect(say('exported').phonemes).toBe('ˈɛkspˌɔɹtᵻd');
  });
  it('splits compounds and CamelCase into known words, second part with secondary stress', () => {
    expect(say('dropdown').phonemes).toBe('dɹˈɑpdˌWn');
    expect(say('Waymark').phonemes).toBe('wˈAmˌɑɹk');
    expect(say('Gmail').phonemes).toBe('ʤˈimˌAl');
    expect(say('QuickBooks').phonemes).toBe('kwˈɪkbˌʊks');
    expect(say('Waymark').guessed).toEqual([]);
    // A compound whose first part has only secondary stress still gets a primary one.
    const weak = new G2P({ get: (w) => ({ whats: 'wˌʌts', app: 'ˈæp' })[w as 'whats' | 'app'] });
    expect(weak.phonemize('WhatsApp').phonemes).toBe('wˈʌtsˌæp');
  });
  it('spells acronyms, reads known ones and shouted words, and spells plural acronyms', () => {
    expect(say('CSV').phonemes).toBe('sˌiˌɛsvˈi');
    expect(say('PDFs').phonemes).toBe('pˌidˌiˈɛfs');
    expect(say('OK').phonemes).toBe('ˌOkˈA');
    expect(say('SAVE').phonemes).toBe('sˈAv');
    expect(say('NEW').phonemes).toBe('nˈu');
  });
  it('reads numbers, money, emails and web addresses', () => {
    expect(say('$25').phonemes).toBe(say('twenty-five dollars').phonemes);
    expect(say('1,250.75').phonemes).toBe('wˈʌn θˈWzᵊnd tˈu hˈʌndɹəd fˈɪfti pˈYnt sˈɛvən fˈIv');
    expect(say('support@acme-corp.com').phonemes).toBe('səpˈɔɹt æt ˈækmi kˈɔɹp dˈɑt kˈɑm');
    expect(say('https://www.example.com/help').phonemes).toBe('ɪɡzˈæmpəl dˈɑt kˈɑm');
    // A bare www address is read as its domain, and its dots don't end the sentence.
    expect(say('Visit www.example.com now').phonemes).toBe(`vˈɪzət ɪɡzˈæmpəl dˈɑt kˈɑm ${say('now').phonemes}`);
  });
  it('guesses unknown words with letter rules, and says so', () => {
    const r = say('Open Jira.');
    expect(r.guessed).toEqual(['Jira']);
    expect(r.phonemes).toBe(`ˈOpᵊn ${letterToSound('Jira')}.`);
  });
  it('never emits characters outside what it was given or its own phoneme set', () => {
    const r = say('Click <b>Save</b> & {press} [OK] ~ ^ | 100%!');
    expect(r.phonemes).not.toMatch(/[<>{}[\]~^|&]/);
  });
  it('lexicon lookups ignore prototype keys', () => {
    expect(() => say('constructor toString __proto__')).not.toThrow();
  });
});

describe('numbers', () => {
  it('cardinals, years, ordinals, times, money and percent', () => {
    expect(cardinal(0)).toBe('zero');
    expect(cardinal(42)).toBe('forty-two');
    expect(cardinal(1_000_001)).toBe('one million one');
    expect(cardinal(310)).toBe('three hundred ten');
    expect(year(2026)).toBe('twenty twenty-six');
    expect(year(2005)).toBe('two thousand five');
    expect(year(1900)).toBe('nineteen hundred');
    expect(year(1905)).toBe('nineteen oh five');
    expect(ordinal(1)).toBe('first');
    expect(ordinal(22)).toBe('twenty-second');
    expect(ordinal(40)).toBe('fortieth');
    expect(numberToWords('2nd')).toBe('second');
    expect(numberToWords('10:30')).toBe('ten thirty');
    expect(numberToWords('9:00')).toBe("nine o'clock");
    expect(numberToWords('$1')).toBe('one dollar');
    expect(numberToWords('15%')).toBe('fifteen percent');
    expect(numberToWords('2026')).toBe('twenty twenty-six');
    expect(numberToWords('2,026')).toBe('two thousand twenty-six');
    expect(numberToWords('3.14')).toBe('three point one four');
    expect(numberToWords('12345678901234567890')).toMatch(/^one two three/);
    expect(numberToWords('1.2.3')).toBeUndefined();
  });
});

describe('letter rules', () => {
  it('give a stressed, pronounceable guess', () => {
    expect(letterToSound('Okta')).toBe('ˈɑktə');
    expect(letterToSound('Jira')).toMatch(/^ʤˈ/);
    expect(letterToSound('make')).toBe('mˈAk');
    expect(letterToSound('station')).toBe('stˈæʃən');
    expect(letterToSound('zzz')).toBe('z');
    expect(letterToSound('')).toBe('');
  });
});

describe('suffix sounds', () => {
  it('follow the stem’s last sound', () => {
    expect(plural('kˈæt')).toBe('kˈæts');
    expect(plural('dˈɔɡ')).toBe('dˈɔɡz');
    expect(plural('bˈɑks')).toBe('bˈɑksᵻz');
    expect(past('wˈɔk')).toBe('wˈɔkt');
    expect(past('nˈid')).toBe('nˈidᵻd');
    expect(past('plˈA')).toBe('plˈAd');
  });
  it('normalize expands symbols', () => {
    expect(normalize('A & B')).toBe('A and B');
    expect(normalize('read/write')).toBe('read slash write');
    expect(normalize('“x”')).toBe('"x"');
  });
});
