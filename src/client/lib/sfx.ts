/**
 * Tiny sound effects for the Learn lesson player, synthesised with WebAudio so
 * there are no audio files to ship. Every call is a no-op when sound is muted,
 * when the browser has no AudioContext, or before the first user gesture (the
 * context is resumed lazily, which is why these are fired from click/Enter
 * handlers).
 */

const STORAGE_KEY = 'aieo.sound';
let context: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

function tone(frequency: number, delay: number, duration: number, type: OscillatorType, gain: number) {
  const audio = ctx();
  if (!audio) return;
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export const sfx = {
  isEnabled(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
      return true;
    }
  },
  setEnabled(value: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
    } catch {
      // Private mode: the preference simply won't persist.
    }
  },
  /** A short rising two-note chime. */
  correct(): void {
    if (!this.isEnabled()) return;
    tone(660, 0, 0.09, 'sine', 0.07);
    tone(880, 0.09, 0.13, 'sine', 0.07);
  },
  /** A low buzz. */
  incorrect(): void {
    if (!this.isEnabled()) return;
    tone(196, 0, 0.2, 'sawtooth', 0.05);
  },
  /** A small arpeggio for finishing a lesson. */
  complete(): void {
    if (!this.isEnabled()) return;
    [523, 659, 784, 1046].forEach((frequency, index) => tone(frequency, index * 0.1, 0.16, 'triangle', 0.06));
  },
};
