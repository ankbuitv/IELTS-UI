/**
 * #39 Accent model shared by the client, the worker and the tests.
 * Keeping it out of `lib/speech.ts` means the pure helpers can be tested (and
 * used in the worker) without a DOM.
 */
export type SpeechAccent = 'UK' | 'AU' | 'US';

export const SPEECH_ACCENTS: Array<{ id: SpeechAccent; label: string; lang: string }> = [
  { id: 'UK', label: 'UK', lang: 'en-GB' },
  { id: 'AU', label: 'AU', lang: 'en-AU' },
  { id: 'US', label: 'US', lang: 'en-US' },
];

export function languageForAccent(accent: SpeechAccent): string {
  return SPEECH_ACCENTS.find((item) => item.id === accent)?.lang ?? 'en-GB';
}

export function accentMatchesLang(accent: SpeechAccent, lang: string): boolean {
  return lang.toLowerCase().replace('_', '-').startsWith(languageForAccent(accent).toLowerCase());
}

export function isSpeechAccent(value: unknown): value is SpeechAccent {
  return value === 'UK' || value === 'AU' || value === 'US';
}
