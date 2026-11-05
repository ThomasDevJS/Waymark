/** Numbers to English words for the HD voice (D51): cardinals, years, decimals, ordinals. */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: [number, string][] = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return below100(r);
  return r ? `${ONES[h]} hundred ${below100(r)}` : `${ONES[h]} hundred`;
}

/** Whole numbers up to 999 trillion; larger ones are read digit by digit. */
export function cardinal(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) return digits(String(n));
  if (n >= 1e15) return digits(String(n));
  if (n < 1000) return below1000(n);
  const parts: string[] = [];
  let rest = n;
  for (const [size, name] of SCALES) {
    if (rest >= size) {
      parts.push(`${below1000(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

export function digits(s: string): string {
  return [...s].map((c) => (/\d/.test(c) ? ONES[Number(c)]! : '')).filter(Boolean).join(' ');
}

/** 1999 → nineteen ninety-nine, 2026 → twenty twenty-six, 2005 → two thousand five, 1900 → nineteen hundred. */
export function year(n: number): string {
  if (n >= 2000 && n < 2010) return cardinal(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (lo === 0) return `${below100(hi)} hundred`;
  return `${below100(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : below100(lo)}`;
}

const ORDINAL_WORDS: Record<string, string> = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
};

export function ordinal(n: number): string {
  const words = cardinal(n);
  const m = /([a-z]+)$/.exec(words);
  if (!m) return words; // read digit by digit (too large to be a cardinal)
  const last = m[1]!;
  const ord = ORDINAL_WORDS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return words.slice(0, m.index) + ord;
}

/**
 * Reads one numeric token: "1,200", "3.5", "2026", "1st", "10:30", "$5", "5%".
 * Returns undefined when the token is not a number this understands.
 */
export function numberToWords(token: string): string | undefined {
  let t = token;
  let prefix = '';
  let suffix = '';
  if (t.startsWith('$')) {
    t = t.slice(1);
    suffix = ' dollars';
  } else if (t.startsWith('€')) {
    t = t.slice(1);
    suffix = ' euros';
  } else if (t.startsWith('£')) {
    t = t.slice(1);
    suffix = ' pounds';
  }
  if (t.endsWith('%')) {
    t = t.slice(0, -1);
    suffix = ' percent';
  }
  if (t.startsWith('-')) {
    t = t.slice(1);
    prefix = 'minus ';
  }
  const ord = /^(\d+)(st|nd|rd|th)$/i.exec(t);
  if (ord) return prefix + (ord[1]!.length > 15 ? digits(ord[1]!) : ordinal(Number(ord[1])));
  const time = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (time) {
    const m = Number(time[2]);
    return `${cardinal(Number(time[1]))} ${m === 0 ? "o'clock" : m < 10 ? `oh ${ONES[m]}` : below100(m)}`;
  }
  if (!/^\d{1,3}(,\d{3})+(\.\d+)?$|^\d+(\.\d+)?$/.test(t)) return undefined;
  const [whole, frac] = t.replace(/,/g, '').split('.') as [string, string | undefined];
  const n = Number(whole);
  if (suffix === ' dollars' && n === 1 && !frac) suffix = ' dollar';
  const wholeWords = !frac && !t.includes(',') && !prefix && !suffix && whole.length === 4 && n >= 1100 && n < 2100 ? year(n) : whole.length > 15 ? digits(whole) : cardinal(n);
  return prefix + wholeWords + (frac ? ` point ${digits(frac)}` : '') + suffix;
}
