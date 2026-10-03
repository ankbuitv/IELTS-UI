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

function pickVoice(voices: SpeechSynthesisVoice[], preferredURI: string | null): SpeechSynthesisVoice | null {
  if (preferredURI) {
    const chosen = voices.find((voice) => voice.voiceURI === preferredURI);
    if (chosen) return chosen;
  }
  return voices.find((voice) => voice.lang === 'en-GB') ?? voices.find((voice) => voice.lang.startsWith('en')) ?? null;
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
export async function speak(text: string, rate = 0.9, preferredVoiceURI?: string | null): Promise<boolean> {
  if (!canSpeak() || !text.trim()) return false;
  try {
    const voices = await loadVoices();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    utterance.rate = rate;
    const voice = pickVoice(voices, preferredVoiceURI ?? getPreferredVoiceURI());
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
