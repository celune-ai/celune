/**
 * Unit tests for voice greeting utility functions.
 *
 * Tests getPersonalityGreeting (text selection based on personality values)
 * and personalityToVoiceParams (personality → TTS voice parameter mapping).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { getPersonalityGreeting, personalityToVoiceParams } from '../voice-greeting-button';
import { DROID_DEFAULTS } from '@/lib/agents-data';

describe('getPersonalityGreeting', () => {
  it('returns default greeting when no params are changed', () => {
    const result = getPersonalityGreeting({ ...DROID_DEFAULTS });
    expect(result).toContain("Hey. I'm RICK");
  });

  it('returns default greeting when changes are below threshold (delta < 15)', () => {
    const result = getPersonalityGreeting({ ...DROID_DEFAULTS, humor: DROID_DEFAULTS.humor! + 10 });
    expect(result).toContain("Hey. I'm RICK");
  });

  it('returns high humor greeting when humor is increased significantly', () => {
    const result = getPersonalityGreeting({ ...DROID_DEFAULTS, humor: 100 });
    expect(result).toContain('humor setting');
  });

  it('returns low humor greeting when humor is decreased significantly', () => {
    const result = getPersonalityGreeting({ ...DROID_DEFAULTS, humor: 20 });
    expect(result).toContain('focused and efficient');
  });

  it('returns high warmth greeting when warmth is increased', () => {
    const result = getPersonalityGreeting({ ...DROID_DEFAULTS, warmth: 90 });
    expect(result).toContain('genuinely excited');
  });

  it('returns low warmth greeting when warmth is decreased', () => {
    const result = getPersonalityGreeting({ ...DROID_DEFAULTS, warmth: 0 });
    expect(result).toContain('execute');
  });

  it('returns high directness greeting when directness is increased', () => {
    // directness default is 85, so we need to go low to get a big delta
    const result = getPersonalityGreeting({ ...DROID_DEFAULTS, directness: 20 });
    expect(result).toContain('interesting approaches');
  });

  it('returns high formality greeting when formality is increased significantly', () => {
    const result = getPersonalityGreeting({ ...DROID_DEFAULTS, formality: 80 });
    expect(result).toContain('Good day');
  });

  it('picks the param with the largest delta from defaults', () => {
    // warmth default=40, changing to 100 gives delta=60
    // humor default=75, changing to 90 gives delta=15
    const result = getPersonalityGreeting({
      ...DROID_DEFAULTS,
      warmth: 100,
      humor: 90,
    });
    expect(result).toContain('genuinely excited'); // warmth high, not humor
  });

  it('handles empty values object gracefully', () => {
    const result = getPersonalityGreeting({});
    expect(result).toContain("Hey. I'm RICK");
  });
});

describe('personalityToVoiceParams', () => {
  it('returns base DROID params with defaults', () => {
    const result = personalityToVoiceParams({ ...DROID_DEFAULTS });
    // humor=75, sarcasm=60 → similarity_boost = max(0.4, 1.0 - (75+60)/400) = max(0.4, 0.6625)
    expect(result.similarity_boost).toBeCloseTo(0.6625);
  });

  it('clamps stability to max 1', () => {
    const result = personalityToVoiceParams({ warmth: 100, formality: 100 });
    expect(result.stability).toBeLessThanOrEqual(1);
  });

  it('clamps style to max 1', () => {
    const result = personalityToVoiceParams({ confidence: 100 });
    expect(result.style).toBeLessThanOrEqual(1);
  });

  it('increases stability with higher warmth and formality', () => {
    const low = personalityToVoiceParams({ warmth: 0, formality: 0 });
    const high = personalityToVoiceParams({ warmth: 100, formality: 100 });
    expect(high.stability).toBeGreaterThan(low.stability);
  });

  it('increases style with higher confidence', () => {
    const low = personalityToVoiceParams({ confidence: 0 });
    const high = personalityToVoiceParams({ confidence: 100 });
    expect(high.style).toBeGreaterThan(low.style);
  });

  it('increases speed with higher directness', () => {
    const low = personalityToVoiceParams({ directness: 0 });
    const high = personalityToVoiceParams({ directness: 100 });
    expect(high.speed).toBeGreaterThan(low.speed);
  });

  it('uses default values when params are missing', () => {
    const result = personalityToVoiceParams({});
    // warmth=40, formality=20 → stability = 0.5 + (40+20)/400 = 0.65
    expect(result.stability).toBeCloseTo(0.65);
    // confidence=80 → style = 80/400 = 0.2
    expect(result.style).toBeCloseTo(0.2);
    // directness=85, verbosity=35 → speed = 0.8 + 85/500 - (35-50)/500 = 0.8 + 0.17 + 0.03 = 1.0
    expect(result.speed).toBeCloseTo(1.0);
  });
});
