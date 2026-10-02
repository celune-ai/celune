import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Save original env
const originalEnv = process.env.ELEVENLABS_API_KEY;

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = 'test-api-key';
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  process.env.ELEVENLABS_API_KEY = originalEnv;
  vi.restoreAllMocks();
});

const mockVoices = [
  {
    voice_id: 'v1',
    name: 'Adam',
    labels: { gender: 'male', accent: 'american' },
    preview_url: 'https://example.com/adam.mp3',
  },
  {
    voice_id: 'v2',
    name: 'Sarah',
    labels: { gender: 'female' },
    preview_url: 'https://example.com/sarah.mp3',
  },
];

describe('elevenlabs service', () => {
  describe('listVoices', () => {
    it('returns mapped voices from ElevenLabs API', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ voices: mockVoices }), { status: 200 }),
      );

      // Dynamic import to get fresh module (cache resets)
      const mod = await import('../elevenlabs');
      const voices = await mod.listVoices();

      expect(voices).toHaveLength(2);
      expect(voices[0]).toEqual({
        voice_id: 'v1',
        name: 'Adam',
        labels: { gender: 'male', accent: 'american' },
        preview_url: 'https://example.com/adam.mp3',
        category: 'premade',
      });
      expect(fetch).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/voices', {
        headers: {
          'xi-api-key': 'test-api-key',
          'Content-Type': 'application/json',
        },
      });
    });

    it('throws on non-OK response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
      );

      const mod = await import('../elevenlabs');
      // Clear cache to force refetch
      await expect(mod.listVoices()).rejects.toThrow('ElevenLabs listVoices failed: 401');
    });

    it('throws when API key is missing', async () => {
      delete process.env.ELEVENLABS_API_KEY;

      const mod = await import('../elevenlabs');
      await expect(mod.listVoices()).rejects.toThrow('ELEVENLABS_API_KEY is not set');
    });
  });

  describe('getVoice', () => {
    it('returns a single voice', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockVoices[0]), { status: 200 }),
      );

      const mod = await import('../elevenlabs');
      const voice = await mod.getVoice('v1');

      expect(voice.voice_id).toBe('v1');
      expect(voice.name).toBe('Adam');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/v1',
        expect.objectContaining({
          headers: expect.objectContaining({ 'xi-api-key': 'test-api-key' }),
        }),
      );
    });

    it('encodes voice ID in URL', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockVoices[0]), { status: 200 }),
      );

      const mod = await import('../elevenlabs');
      await mod.getVoice('id/with/slashes');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/id%2Fwith%2Fslashes',
        expect.any(Object),
      );
    });
  });

  describe('generateSpeech', () => {
    it('returns audio buffer', async () => {
      const audioData = new ArrayBuffer(100);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(audioData, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }),
      );

      const mod = await import('../elevenlabs');
      const result = await mod.generateSpeech('v1', 'Hello world');

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/v1?output_format=mp3_44100_128',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"text":"Hello world"'),
        }),
      );
    });

    it('uses custom params when provided', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(new ArrayBuffer(10), { status: 200 }),
      );

      const mod = await import('../elevenlabs');
      await mod.generateSpeech('v1', 'Test', { stability: 0.8, similarity_boost: 0.9, style: 0.3 });

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.voice_settings).toEqual({
        stability: 0.8,
        similarity_boost: 0.9,
        style: 0.3,
      });
    });

    it('uses defaults when params not provided', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(new ArrayBuffer(10), { status: 200 }),
      );

      const mod = await import('../elevenlabs');
      await mod.generateSpeech('v1', 'Test');

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.voice_settings).toEqual({
        stability: 0.4,
        similarity_boost: 0.75,
        style: 0.04,
      });
    });

    it('throws on TTS failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Rate limited', { status: 429, statusText: 'Too Many Requests' }),
      );

      const mod = await import('../elevenlabs');
      await expect(mod.generateSpeech('v1', 'Test')).rejects.toThrow('ElevenLabs TTS failed: 429');
    });
  });
});
