import { describe, expect, it } from 'vitest';
import { SPEECH_ACCENTS, accentMatchesLang, languageForAccent } from '../../src/shared/speech-accent';
import { SERVER_SPEECH_ACCENTS, SPEECH_ACCENT_INSTRUCTIONS, isSpeechAccent } from '../../src/worker/ai/providers';

describe('speech accents', () => {
  it('maps each accent to the matching language tag', () => {
    expect(languageForAccent('UK')).toBe('en-GB');
    expect(languageForAccent('AU')).toBe('en-AU');
    expect(languageForAccent('US')).toBe('en-US');
    expect(SPEECH_ACCENTS.map((item) => item.id)).toEqual(['UK', 'AU', 'US']);
  });

  it('matches device voices by region, including underscored tags', () => {
    expect(accentMatchesLang('UK', 'en-GB')).toBe(true);
    expect(accentMatchesLang('AU', 'en_AU')).toBe(true);
    expect(accentMatchesLang('US', 'en-US')).toBe(true);
    expect(accentMatchesLang('UK', 'en-US')).toBe(false);
  });

  it('accepts only the three server accents', () => {
    expect([...SERVER_SPEECH_ACCENTS]).toEqual(['UK', 'AU', 'US']);
    expect(isSpeechAccent('UK')).toBe(true);
    expect(isSpeechAccent('uk')).toBe(false);
    expect(isSpeechAccent('CA')).toBe(false);
  });

  it('asks the provider for the chosen accent in words', () => {
    expect(SPEECH_ACCENT_INSTRUCTIONS.UK).toMatch(/British/);
    expect(SPEECH_ACCENT_INSTRUCTIONS.AU).toMatch(/Australian/);
    expect(SPEECH_ACCENT_INSTRUCTIONS.US).toMatch(/American/);
  });
});
