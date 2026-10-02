/**
 * TTS Text Preprocessing Pipeline
 *
 * Transforms raw text into TTS-friendly format before sending to ElevenLabs.
 * Pure function — no side effects, no I/O.
 */

// ── Number-to-words helpers ──────────────────────────────────────────

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999_999) return String(n);
  if (n === 0) return 'zero';

  const chunks: string[] = [];
  const scales = ['', ' thousand', ' million', ' billion'];

  let remaining = Math.floor(n);
  let scaleIdx = 0;

  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      chunks.unshift(chunkToWords(chunk) + scales[scaleIdx]);
    }
    remaining = Math.floor(remaining / 1000);
    scaleIdx++;
  }

  return chunks.join(' ');
}

function chunkToWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const remainder = n % 10;
    return TENS[Math.floor(n / 10)] + (remainder ? '-' + ONES[remainder] : '');
  }
  const remainder = n % 100;
  return ONES[Math.floor(n / 100)] + ' hundred' + (remainder ? ' ' + chunkToWords(remainder) : '');
}

// ── Month names ──────────────────────────────────────────────────────

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function ordinal(n: number): string {
  const special: Record<number, string> = {
    1: 'first',
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'eighth',
    9: 'ninth',
    10: 'tenth',
    11: 'eleventh',
    12: 'twelfth',
    13: 'thirteenth',
    14: 'fourteenth',
    15: 'fifteenth',
    16: 'sixteenth',
    17: 'seventeenth',
    18: 'eighteenth',
    19: 'nineteenth',
    20: 'twentieth',
    21: 'twenty-first',
    22: 'twenty-second',
    23: 'twenty-third',
    24: 'twenty-fourth',
    25: 'twenty-fifth',
    26: 'twenty-sixth',
    27: 'twenty-seventh',
    28: 'twenty-eighth',
    29: 'twenty-ninth',
    30: 'thirtieth',
    31: 'thirty-first',
  };
  return special[n] || numberToWords(n) + 'th';
}

// ── Abbreviation map ─────────────────────────────────────────────────

const ABBREVIATIONS: Record<string, string> = {
  'Dr.': 'Doctor',
  'Mr.': 'Mister',
  'Mrs.': 'Missus',
  'Ms.': 'Ms',
  'Jr.': 'Junior',
  'Sr.': 'Senior',
  'vs.': 'versus',
  'etc.': 'et cetera',
  'e.g.': 'for example',
  'i.e.': 'that is',
  'approx.': 'approximately',
  'dept.': 'department',
  'govt.': 'government',
  'St.': 'Saint',
  'Ave.': 'Avenue',
  'Blvd.': 'Boulevard',
};

// ── URL / code block detection ───────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s)]+/g;
const CODE_BLOCK_REGEX = /```[\s\S]*?```|`[^`]+`/g;

function buildProtectedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const regex of [URL_REGEX, CODE_BLOCK_REGEX]) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

function isProtected(index: number, length: number, ranges: Array<[number, number]>): boolean {
  const end = index + length;
  return ranges.some(([s, e]) => index >= s && end <= e);
}

// ── Individual transform functions ───────────────────────────────────

function expandAbbreviations(text: string, ranges: Array<[number, number]>): string {
  // Sort by length descending to match longer abbreviations first (e.g. "e.g." before "g.")
  const sorted = Object.entries(ABBREVIATIONS).sort((a, b) => b[0].length - a[0].length);

  for (const [abbr, expansion] of sorted) {
    const escaped = abbr.replace(/\./g, '\\.');
    const regex = new RegExp(`\\b${escaped}`, 'g');
    let match: RegExpExecArray | null;
    const replacements: Array<{ index: number; length: number; replacement: string }> = [];

    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      if (!isProtected(match.index, match[0].length, ranges)) {
        replacements.push({
          index: match.index,
          length: match[0].length,
          replacement: expansion,
        });
      }
    }

    // Apply replacements in reverse order to preserve indices
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i];
      text = text.slice(0, r.index) + r.replacement + text.slice(r.index + r.length);
    }
  }

  return text;
}

function expandCurrency(text: string, ranges: Array<[number, number]>): string {
  // $X,XXX.XX pattern
  return text.replace(
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/g,
    (match, numStr: string, offset: number) => {
      if (isProtected(offset, match.length, ranges)) return match;

      const cleaned = numStr.replace(/,/g, '');
      const parts = cleaned.split('.');
      const dollars = parseInt(parts[0], 10);
      const cents = parts[1] ? parseInt(parts[1].padEnd(2, '0'), 10) : 0;

      let result = numberToWords(dollars) + ' dollar' + (dollars !== 1 ? 's' : '');
      if (cents > 0) {
        result += ' and ' + numberToWords(cents) + ' cent' + (cents !== 1 ? 's' : '');
      }
      return result;
    },
  );
}

function expandPercentages(text: string, ranges: Array<[number, number]>): string {
  return text.replace(/(\d+(?:\.\d+)?)%/g, (match, numStr: string, offset: number) => {
    if (isProtected(offset, match.length, ranges)) return match;
    const num = parseFloat(numStr);
    if (Number.isInteger(num)) {
      return numberToWords(num) + ' percent';
    }
    return expandDecimal(numStr) + ' percent';
  });
}

function expandDecimal(numStr: string): string {
  const parts = numStr.split('.');
  const whole = parseInt(parts[0], 10);
  const decimalDigits = parts[1] || '';

  let result = numberToWords(whole) + ' point';
  for (const digit of decimalDigits) {
    result += ' ' + numberToWords(parseInt(digit, 10));
  }
  return result;
}

function expandDates(text: string, ranges: Array<[number, number]>): string {
  // MM/DD/YYYY
  text = text.replace(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
    (match, mm: string, dd: string, yyyy: string, offset: number) => {
      if (isProtected(offset, match.length, ranges)) return match;
      const month = parseInt(mm, 10);
      const day = parseInt(dd, 10);
      const year = parseInt(yyyy, 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) return match;
      return `${MONTHS[month - 1]} ${ordinal(day)}, ${numberToWords(year)}`;
    },
  );

  // YYYY-MM-DD
  text = text.replace(
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    (match, yyyy: string, mm: string, dd: string, offset: number) => {
      if (isProtected(offset, match.length, ranges)) return match;
      const month = parseInt(mm, 10);
      const day = parseInt(dd, 10);
      const year = parseInt(yyyy, 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) return match;
      return `${MONTHS[month - 1]} ${ordinal(day)}, ${numberToWords(year)}`;
    },
  );

  return text;
}

function expandTime(text: string, ranges: Array<[number, number]>): string {
  return text.replace(
    /\b(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a\.m\.|p\.m\.)\b/g,
    (match, h: string, m: string, period: string, offset: number) => {
      if (isProtected(offset, match.length, ranges)) return match;
      const hour = parseInt(h, 10);
      const min = parseInt(m, 10);
      if (hour > 12 || min > 59) return match;

      const normalizedPeriod = period.replace(/\./g, '').toUpperCase();
      const minuteStr = min === 0 ? '' : ' ' + numberToWords(min);
      return numberToWords(hour) + minuteStr + ' ' + normalizedPeriod;
    },
  );
}

function expandNumbers(text: string, ranges: Array<[number, number]>): string {
  // Decimals (e.g. 3.14) — must come before integers
  text = text.replace(/\b(\d+\.\d+)\b/g, (match, numStr: string, offset: number) => {
    if (isProtected(offset, match.length, ranges)) return match;
    return expandDecimal(numStr);
  });

  // Comma-separated numbers (e.g. 1,500)
  text = text.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (match, numStr: string, offset: number) => {
    if (isProtected(offset, match.length, ranges)) return match;
    const n = parseInt(numStr.replace(/,/g, ''), 10);
    return numberToWords(n);
  });

  // Plain integers — only match standalone numbers not part of dates/times/other patterns
  text = text.replace(
    /(?<![\/\-:.$])(\b\d+\b)(?![\/\-:.])/g,
    (match, numStr: string, offset: number) => {
      if (isProtected(offset, match.length, ranges)) return match;
      const n = parseInt(numStr, 10);
      if (n > 999_999_999_999) return match;
      return numberToWords(n);
    },
  );

  return text;
}

// ── ElevenLabs v3 audio tags per agent persona ──────────────────────

const V3_AUDIO_TAGS: Record<string, string> = {
  rick: '[flatly] ',
  sage: '[warmly] ',
  noir: '[smoothly] ',
  scan: '[matter-of-factly] ',
  delv: '[curiously] ',
  trek: '[encouragingly] ',
  echo: '[professionally] ',
  bond: '[gently] ',
  vita: '[cheerfully] ',
};

/**
 * Prepend persona-appropriate v3 audio tags to text.
 * Only applies when using the eleven_v3 model — returns text unchanged for v2.
 */
export function prependV3AudioTags(text: string, agentId: string, modelId?: string): string {
  if (!text || !modelId?.startsWith('eleven_v3')) return text;
  const tag = V3_AUDIO_TAGS[agentId];
  if (!tag) return text;
  return tag + text;
}

// ── Main export ──────────────────────────────────────────────────────

export function preprocessForTTS(text: string): string {
  if (!text) return text;

  const ranges = buildProtectedRanges(text);

  // Order matters: currency/percentages before generic numbers
  text = expandAbbreviations(text, ranges);
  text = expandCurrency(text, ranges);
  text = expandPercentages(text, ranges);
  text = expandDates(text, ranges);
  text = expandTime(text, ranges);
  text = expandNumbers(text, ranges);

  return text;
}
