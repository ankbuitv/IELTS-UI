/** Speaks an English word or sentence with the browser's own voice. Returns false when the browser cannot. */
export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function speak(text: string, rate = 0.9): boolean {
  if (!canSpeak() || !text.trim()) return false;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB';
    utterance.rate = rate;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((item) => item.lang === 'en-GB') ?? voices.find((item) => item.lang.startsWith('en'));
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
