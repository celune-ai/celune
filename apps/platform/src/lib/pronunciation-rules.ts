export interface PronunciationRule {
  term: string;
  pronunciation: string;
  /** PLS alphabet, defaults to 'ipa' if not set */
  alphabet?: string;
}

export const PRONUNCIATION_RULES: PronunciationRule[] = [
  // Agent names (all-caps acronyms → spoken naturally)
  { term: 'RICK', pronunciation: 'Rick' },
  { term: 'SAGE', pronunciation: 'Sage' },
  { term: 'NOIR', pronunciation: 'Nwar' },
  { term: 'SCAN', pronunciation: 'Scan' },
  { term: 'DELV', pronunciation: 'Delve' },
  { term: 'TREK', pronunciation: 'Trek' },
  { term: 'ECHO', pronunciation: 'Echo' },
  { term: 'BOND', pronunciation: 'Bond' },
  { term: 'VITA', pronunciation: 'Vee-tah' },
  { term: 'DROID', pronunciation: 'Droid' },

  // Platform & infra terms
  { term: 'Supabase', pronunciation: 'SOO-pah-base' },
  { term: 'Turborepo', pronunciation: 'TUR-bo-repo' },
  { term: 'pnpm', pronunciation: 'pee-en-pee-em' },
  { term: 'Next.js', pronunciation: 'Next JS' },
  { term: 'Vercel', pronunciation: 'Ver-SELL' },
  { term: 'ElevenLabs', pronunciation: 'Eleven Labs' },
  { term: 'TTS', pronunciation: 'tee-tee-ess' },

  // Project / process terms
  { term: 'PRD', pronunciation: 'P-R-D' },
  { term: 'RFC', pronunciation: 'R-F-C' },
  { term: 'kanban', pronunciation: 'KAHN-bahn' },
  { term: 'RLS', pronunciation: 'R-L-S' },
  { term: 'CRUD', pronunciation: 'crud' },
  { term: 'API', pronunciation: 'A-P-I' },
  { term: 'SSR', pronunciation: 'S-S-R' },
  { term: 'SSE', pronunciation: 'S-S-E' },
];

/**
 * Build a PLS (Pronunciation Lexicon Specification) XML string from rules.
 * ElevenLabs accepts this format for dictionary uploads.
 */
export function buildPlsXml(rules: PronunciationRule[]): string {
  const entries = rules
    .map((r) => {
      const alphabet = r.alphabet ?? 'x-sampa';
      return [
        '    <lexeme>',
        `      <grapheme>${escapeXml(r.term)}</grapheme>`,
        `      <phoneme alphabet="${alphabet}">${escapeXml(r.pronunciation)}</phoneme>`,
        '    </lexeme>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<lexicon version="1.0"',
    '  xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '  xsi:schemaLocation="http://www.w3.org/2005/01/pronunciation-lexicon http://www.w3.org/TR/2007/CR-pronunciation-lexicon-20071212/pls.xsd"',
    '  alphabet="x-sampa" xml:lang="en-US">',
    entries,
    '</lexicon>',
  ].join('\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
