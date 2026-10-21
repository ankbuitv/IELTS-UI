import { accentMatchesLang, languageForAccent, type SpeechAccent } from '@shared/speech-accent';

/**
 * Speaking text with the browser's own voices.
 *
 * The browser's speech engine is the fallback narrator for the whole app, and
 * it has two well-known traps that this file exists to dodge:
 *
 *   - `speechSynthesis.getVoices()` returns an empty array on the first call in
 *     Chrome and Safari, and only fills in once the `voiceschanged` event fires.
 *     Using it synchronously therefore "works" with a voice that does not exist,
 *     and on a device whose default voice is not English the word is simply not
 *     heard. We wait for the list (briefly) and pick an English voice on purpose.
 *   - Chrome pauses synthesis on long utterances after ~15s and some embedded
 *     webviews require a `resume()` nudge. A short keep-alive keeps them talking.
 *
 * Everything here degrades to `false` / `[]` when the browser cannot speak at
 * all, so callers can fall back to showing the text instead of a silent button.
 */

let voicesChangedWired = false;

/** Re-exported so callers only import `lib/speech`. */
export {
  SPEECH_ACCENTS,
  accentMatchesLang,
  isSpeechAccent,
  languageForAccent,
  type SpeechAccent,
} from '@shared/speech-accent';

const ACCENT_KEY = 'aieo.accent';

/** The accent the learner last chose; British is the default for IELTS practice. */
export function getPreferredAccent(): SpeechAccent {
  try {
    const stored = window.localStorage.getItem(ACCENT_KEY);
    return stored === 'UK' || stored === 'AU' || stored === 'US' ? stored : 'UK';
  } catch {
    return 'UK';
  }
}

export function setPreferredAccent(accent: SpeechAccent) {
  try {
    window.localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // Private mode: the choice applies for this session only.
  }
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

function wireVoicesChanged() {
  if (voicesChangedWired || !canSpeak()) return;
  voicesChangedWired = true;
  // Waking the engine is what makes some browsers actually load their voices.
  window.speechSynthesis.getVoices();
}

/** Resolves to the voice list, waiting (briefly) for the browser to finish loading it. */
function loadVoices(timeoutMs = 500): Promise<SpeechSynthesisVoice[]> {
  if (!canSpeak()) return Promise.resolve([]);
  wireVoicesChanged();
  const ready = window.speechSynthesis.getVoices();
  if (ready.length > 0) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(window.speechSynthesis.getVoices());
    }, timeoutMs);
    const onReady = () => {
      cleanup();
      resolve(window.speechSynthesis.getVoices());
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      window.speechSynthesis.removeEventListener('voiceschanged', onReady);
    };
    window.speechSynthesis.addEventListener('voiceschanged', onReady);
  });
}

/**
 * The English voices this device can actually use, best first, for a picker.
 * Prefers names that sound natural for language practice.
 */
export async function listEnglishVoices(): Promise<SpeechSynthesisVoice[]> {
  const all = await loadVoices();
  const english = all.filter((voice) => voice.lang.toLowerCase().startsWith('en'));
  const preferred = ['google uk english female', 'google us english', 'daniel', 'kate', 'serena', 'aria', 'jenny', 'sonia'];
  const rank = (voice: SpeechSynthesisVoice) => {
    const name = voice.name.toLowerCase();
    const hit = preferred.findIndex((token) => name.includes(token));
    return hit === -1 ? 99 : hit;
  };
  return english.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function pickVoice(
  voices: SpeechSynthesisVoice[],
  preferredURI: string | null,
  accent: SpeechAccent,
): SpeechSynthesisVoice | null {
  if (preferredURI) {
    const chosen = voices.find((voice) => voice.voiceURI === preferredURI);
    // A voice in the wrong accent is worse than none: the point of the picker
    // is that UK practice sounds British and AU practice sounds Australian.
    if (chosen && accentMatchesLang(accent, chosen.lang)) return chosen;
  }
  const target = languageForAccent(accent);
  return (
    voices.find((voice) => voice.lang.toLowerCase() === target.toLowerCase()) ??
    voices.find((voice) => accentMatchesLang(accent, voice.lang)) ??
    voices.find((voice) => voice.lang.toLowerCase() === 'en-gb') ??
    voices.find((voice) => voice.lang.startsWith('en')) ??
    null
  );
}

/**
 * The voice the learner last chose for practice, kept on this device.
 */
const VOICE_KEY = 'aieo.voice';
export function getPreferredVoiceURI(): string | null {
  try {
    return window.localStorage.getItem(VOICE_KEY);
  } catch {
    return null;
  }
}
export function setPreferredVoiceURI(uri: string | null) {
  try {
    if (uri === null) window.localStorage.removeItem(VOICE_KEY);
    else window.localStorage.setItem(VOICE_KEY, uri);
  } catch {
    // Private mode: the choice simply will not persist.
  }
}

/**
 * Speaks the text and resolves true once it has genuinely started.
 *
 * Resolves false — rather than pretending — when the browser cannot speak, so a
 * caller can show the words instead of leaving a silent button.
 */
export async function speak(
  text: string,
  rate = 0.9,
  preferredVoiceURI?: string | null,
  preferredAccent?: SpeechAccent,
): Promise<boolean> {
  if (!canSpeak() || !text.trim()) return false;
  try {
    const voices = await loadVoices();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const accent = preferredAccent ?? getPreferredAccent();
    utterance.lang = languageForAccent(accent);
    utterance.rate = rate;
    const voice = pickVoice(voices, preferredVoiceURI ?? getPreferredVoiceURI(), accent);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    const result = await new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        window.clearInterval(keepAlive);
        resolve(ok);
      };
      utterance.onstart = () => done(true);
      utterance.onerror = () => done(false);
      // Chrome throttles synthesis; a gentle resume keeps it moving.
      const keepAlive = window.setInterval(() => {
        if (!window.speechSynthesis.speaking) window.clearInterval(keepAlive);
        else window.speechSynthesis.resume();
      }, 5_000);
      window.speechSynthesis.speak(utterance);
    });
    return result;
  } catch {
    return false;
  }
}

/** Speaks without waiting for the caller; for one-line `onClick` handlers. */
export function speakNow(text: string, rate = 0.9) {
  void speak(text, rate);
}

/** Server voices are stored with a `srv:` prefix so a choice can name either kind. */
export const isServerVoice = (choice: string | null): boolean => Boolean(choice && choice.startsWith('srv:'));
export const serverVoiceOf = (choice: string): string => choice.slice(4);

/** The provider voices the server can actually speak with; [] when none is configured. */
export async function listServerVoices(): Promise<string[]> {
  try {
    const response = await fetch('/api/learn/speech/voices', { credentials: 'include' });
    if (!response.ok) return [];
    const data = (await response.json()) as { voices?: string[] };
    return Array.isArray(data.voices) ? data.voices : [];
  } catch {
    return [];
  }
}

/**
 * Plays text with a provider voice by streaming the generated audio.
 * Resolves false when there is no provider or the download fails, so the caller
 * can fall back to the browser's own engine.
 */
export async function speakWithServer(text: string, voice: string, accent: SpeechAccent = getPreferredAccent()): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/learn/speech?${new URLSearchParams({ text, voice, accent })}`,
      { credentials: 'include' },
    );
    if (!response.ok) return false;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    return await new Promise<boolean>((resolve) => {
      const element = new Audio(url);
      const done = (ok: boolean) => {
        URL.revokeObjectURL(url);
        resolve(ok);
      };
      element.onended = () => done(true);
      element.onerror = () => done(false);
      void element.play().catch(() => done(false));
    });
  } catch {
    return false;
  }
}

