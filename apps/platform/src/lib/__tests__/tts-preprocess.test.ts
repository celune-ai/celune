import { describe, it, expect } from 'vitest';
import { preprocessForTTS, prependV3AudioTags } from '../tts-preprocess';

describe('preprocessForTTS', () => {
  describe('numbers', () => {
    it('converts simple integers', () => {
      expect(preprocessForTTS('There are 100 items')).toBe('There are one hundred items');
    });

    it('converts comma-separated numbers', () => {
      expect(preprocessForTTS('Population is 1,500')).toBe(
        'Population is one thousand five hundred',
      );
    });

    it('converts decimals', () => {
      expect(preprocessForTTS('Pi is 3.14')).toBe('Pi is three point one four');
    });

    it('converts zero', () => {
      expect(preprocessForTTS('Score is 0')).toBe('Score is zero');
    });

    it('handles large numbers', () => {
      expect(preprocessForTTS('Revenue hit 2,000,000')).toBe('Revenue hit two million');
    });
  });

  describe('currency', () => {
    it('converts dollars and cents', () => {
      expect(preprocessForTTS('Price is $25.99')).toBe(
        'Price is twenty-five dollars and ninety-nine cents',
      );
    });

    it('converts whole dollar amounts', () => {
      expect(preprocessForTTS('Cost $100')).toBe('Cost one hundred dollars');
    });

    it('converts large currency amounts', () => {
      expect(preprocessForTTS('Budget is $1,500')).toBe(
        'Budget is one thousand five hundred dollars',
      );
    });

    it('handles singular dollar', () => {
      expect(preprocessForTTS('Just $1')).toBe('Just one dollar');
    });

    it('handles singular cent', () => {
      expect(preprocessForTTS('Fee is $0.01')).toBe('Fee is zero dollars and one cent');
    });
  });

  describe('dates', () => {
    it('converts MM/DD/YYYY format', () => {
      expect(preprocessForTTS('Due on 03/04/2026')).toBe(
        'Due on March fourth, two thousand twenty-six',
      );
    });

    it('converts YYYY-MM-DD format', () => {
      expect(preprocessForTTS('Released 2026-03-04')).toBe(
        'Released March fourth, two thousand twenty-six',
      );
    });

    it('handles single-digit month/day', () => {
      expect(preprocessForTTS('On 1/1/2026')).toBe('On January first, two thousand twenty-six');
    });
  });

  describe('abbreviations', () => {
    it('expands Dr.', () => {
      expect(preprocessForTTS('Dr. Smith is here')).toBe('Doctor Smith is here');
    });

    it('expands Mr.', () => {
      expect(preprocessForTTS('Mr. Jones arrived')).toBe('Mister Jones arrived');
    });

    it('expands vs.', () => {
      expect(preprocessForTTS('React vs. Vue')).toBe('React versus Vue');
    });

    it('expands etc.', () => {
      expect(preprocessForTTS('HTML, CSS, etc.')).toBe('HTML, CSS, et cetera');
    });

    it('expands e.g.', () => {
      expect(preprocessForTTS('Languages e.g. Python')).toBe('Languages for example Python');
    });

    it('expands i.e.', () => {
      expect(preprocessForTTS('The leader i.e. the CEO')).toBe('The leader that is the CEO');
    });
  });

  describe('percentages', () => {
    it('converts integer percentages', () => {
      expect(preprocessForTTS('Up 50% today')).toBe('Up fifty percent today');
    });

    it('converts decimal percentages', () => {
      expect(preprocessForTTS('Rate is 3.5%')).toBe('Rate is three point five percent');
    });
  });

  describe('time', () => {
    it('converts time with PM', () => {
      expect(preprocessForTTS('Meeting at 3:30 PM')).toBe('Meeting at three thirty PM');
    });

    it('converts time on the hour', () => {
      expect(preprocessForTTS('Starts at 9:00 AM')).toBe('Starts at nine AM');
    });

    it('converts lowercase am/pm', () => {
      expect(preprocessForTTS('Call at 2:15 pm')).toBe('Call at two fifteen PM');
    });
  });

  describe('protected ranges', () => {
    it('does not transform text inside code blocks', () => {
      const input = 'Run `curl $100` to test';
      expect(preprocessForTTS(input)).toBe('Run `curl $100` to test');
    });

    it('does not transform URLs', () => {
      const input = 'Visit https://example.com/page/123 for details';
      expect(preprocessForTTS(input)).toBe('Visit https://example.com/page/123 for details');
    });

    it('does not transform fenced code blocks', () => {
      const input = 'Example:\n```\nlet x = 100;\n```\nDone';
      expect(preprocessForTTS(input)).toBe('Example:\n```\nlet x = 100;\n```\nDone');
    });
  });

  describe('edge cases', () => {
    it('returns empty string unchanged', () => {
      expect(preprocessForTTS('')).toBe('');
    });

    it('handles text with no patterns', () => {
      expect(preprocessForTTS('Hello world')).toBe('Hello world');
    });

    it('handles multiple patterns in one string', () => {
      const result = preprocessForTTS('Dr. Smith spent $25.99 on 03/04/2026');
      expect(result).toBe(
        'Doctor Smith spent twenty-five dollars and ninety-nine cents on March fourth, two thousand twenty-six',
      );
    });

    it('preserves acronyms', () => {
      expect(preprocessForTTS('The API and TTS are working')).toBe('The API and TTS are working');
    });
  });
});

describe('prependV3AudioTags', () => {
  it('prepends audio tag for v3 model', () => {
    expect(prependV3AudioTags('Hello world', 'rick', 'eleven_v3')).toBe('[flatly] Hello world');
  });

  it('returns text unchanged for v2 model', () => {
    expect(prependV3AudioTags('Hello world', 'rick', 'eleven_flash_v2_5')).toBe('Hello world');
  });

  it('returns text unchanged when no model specified', () => {
    expect(prependV3AudioTags('Hello world', 'rick')).toBe('Hello world');
    expect(prependV3AudioTags('Hello world', 'rick', undefined)).toBe('Hello world');
  });

  it('returns text unchanged for unknown agent', () => {
    expect(prependV3AudioTags('Hello world', 'unknown-agent', 'eleven_v3')).toBe('Hello world');
  });

  it('maps each agent to the correct tag', () => {
    const expected: Record<string, string> = {
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
    for (const [agent, tag] of Object.entries(expected)) {
      expect(prependV3AudioTags('Test', agent, 'eleven_v3')).toBe(tag + 'Test');
    }
  });

  it('returns empty string unchanged', () => {
    expect(prependV3AudioTags('', 'rick', 'eleven_v3')).toBe('');
  });
});
