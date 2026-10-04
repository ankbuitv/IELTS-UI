/**
 * Sound effects, synthesised with WebAudio so there are no audio files to ship.
 *
 * One sound per event, and no two events share one: a tap is a click, a right
 * answer is a rising third, a wrong one is a falling buzz, a lost heart is a
 * thud, a combo climbs a pentatonic ladder, and finishing a lesson is a
 * different fanfare from finishing a perfect one. The point of the variety is
 * that the learner stops reading the screen to know how it went — the sound
 * carries the verdict on its own.
 *
 * Rules that keep this from being annoying:
 *
 *   * everything is a no-op when sound is muted, when the browser has no
 *     AudioContext, or before the first user gesture (the context is resumed
 *     lazily, which is why the calls happen in click/Enter handlers);
 *   * effects are short (30 ms to 700 ms) and quiet (a master gain of 0.5, and
 *     each voice well below that);
 *   * a "noise" voice is generated from a short buffer rather than an
 *     oscillator, because whooshes and thuds need texture, not pitch;
 *   * every voice is disconnected on `stop`, so a lesson's worth of effects
 *     leaves no nodes attached to the graph.
 *
 * The library is exported so the shop can offer a "listen to the sounds" panel
 * — a learner who is going to hear these a few hundred times should be able to
 * try them before turning them off.
 */

const STORAGE_KEY = 'aieo.sound';
let context: AudioContext | null = null;
let master: GainNode | null = null;

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
    } catch {
      return null;
    }
  }
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

// ------------------------------------------------------------------ voices
interface ToneOptions {
  /** Seconds after "now" to start. */
  delay?: number;
  /** Seconds the note lasts. */
  duration?: number;
  type?: OscillatorType;
  gain?: number;
  /** Slide to this frequency over the note. */
  to?: number;
}

/** One oscillator with a percussive envelope. */
function tone(frequency: number, options: ToneOptions = {}): void {
  const audio = ctx();
  if (!audio || !master) return;
  const { delay = 0, duration = 0.14, type = 'sine', gain = 0.07, to } = options;
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, to), start + duration);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.012, duration / 3));
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope).connect(master);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
  };
}

/** A short burst of filtered noise: thuds, whooshes and applause-ish tails. */
function noise(options: { delay?: number; duration?: number; gain?: number; from?: number; to?: number; q?: number } = {}): void {
  const audio = ctx();
  if (!audio || !master) return;
  const { delay = 0, duration = 0.25, gain = 0.05, from = 900, to = 180, q = 1 } = options;
  const start = audio.currentTime + delay;
  const frames = Math.max(1, Math.floor(audio.sampleRate * duration));
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    // White noise with a linear fade, so the burst ends rather than clicks.
    data[index] = (Math.random() * 2 - 1) * (1 - index / frames);
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, to), start + duration);
  const envelope = audio.createGain();
  envelope.gain.setValueAtTime(gain, start);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(envelope).connect(master);
  source.start(start);
  source.stop(start + duration + 0.02);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    envelope.disconnect();
  };
}

/** Several tones at once or in sequence. */
function notes(list: Array<[frequency: number, options?: ToneOptions]>): void {
  for (const [frequency, options] of list) tone(frequency, options);
}

// --------------------------------------------------------------- the library
export const SFX_NAMES = [
  'tap',
  'select',
  'correct',
  'almost',
  'wrong',
  'heartLost',
  'outOfHearts',
  'combo',
  'match',
  'reveal',
  'hint',
  'coin',
  'buy',
  'boost',
  'freeze',
  'streak',
  'dailyGoal',
  'levelUp',
  'lessonStart',
  'complete',
  'perfect',
  'fail',
  'unlock',
  'error',
  'whoosh',
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/** The gallery the shop shows, in the order a learner meets them. */
export const SFX_LIBRARY: Array<{ name: SfxName; label: string; when: string }> = [
  { name: 'tap', label: 'Tap', when: 'Choosing an option' },
  { name: 'select', label: 'Select', when: 'A card is picked up' },
  { name: 'match', label: 'Match', when: 'A pair clicks together' },
  { name: 'correct', label: 'Correct', when: 'A right answer' },
  { name: 'combo', label: 'Combo', when: 'Right answers in a row' },
  { name: 'almost', label: 'Almost', when: 'Right, but a slip' },
  { name: 'wrong', label: 'Wrong', when: 'A wrong answer' },
  { name: 'heartLost', label: 'Heart lost', when: 'One heart fewer' },
  { name: 'outOfHearts', label: 'Out of hearts', when: 'The lesson ends' },
  { name: 'hint', label: 'Hint', when: 'A hint is used' },
  { name: 'reveal', label: 'Reveal', when: 'The answer appears' },
  { name: 'coin', label: 'Coin', when: 'Coins are paid' },
  { name: 'buy', label: 'Buy', when: 'Something is bought' },
  { name: 'boost', label: 'Boost', when: 'Double XP starts' },
  { name: 'freeze', label: 'Freeze', when: 'A streak is saved' },
  { name: 'streak', label: 'Streak', when: 'The streak grows' },
  { name: 'dailyGoal', label: 'Daily goal', when: 'The goal is reached' },
  { name: 'levelUp', label: 'Level up', when: 'A new band opens' },
  { name: 'lessonStart', label: 'Lesson start', when: 'A lesson opens' },
  { name: 'complete', label: 'Complete', when: 'A lesson is finished' },
  { name: 'perfect', label: 'Perfect', when: 'Every answer was right' },
  { name: 'fail', label: 'Fail', when: 'A lesson is lost' },
  { name: 'unlock', label: 'Unlock', when: 'A lesson is unlocked' },
  { name: 'error', label: 'Error', when: 'Something failed to save' },
  { name: 'whoosh', label: 'Whoosh', when: 'Moving between questions' },
];

const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

function playSound(name: SfxName, level = 1): void {
  switch (name) {
    case 'tap':
      tone(1180, { duration: 0.035, type: 'square', gain: 0.03 });
      break;
    case 'select':
      notes([
        [740, { duration: 0.05, type: 'triangle', gain: 0.045 }],
        [988, { delay: 0.045, duration: 0.07, type: 'triangle', gain: 0.045 }],
      ]);
      break;
    case 'correct':
      notes([
        [659.25, { duration: 0.1, type: 'sine', gain: 0.08 }],
        [987.77, { delay: 0.08, duration: 0.16, type: 'sine', gain: 0.07 }],
        [1318.51, { delay: 0.16, duration: 0.2, type: 'triangle', gain: 0.035 }],
      ]);
      break;
    case 'almost':
      notes([
        [622.25, { duration: 0.11, type: 'triangle', gain: 0.06 }],
        [659.25, { delay: 0.11, duration: 0.14, type: 'triangle', gain: 0.055 }],
      ]);
      break;
    case 'wrong':
      notes([
        [311.13, { duration: 0.16, type: 'sawtooth', gain: 0.045, to: 233.08 }],
        [207.65, { delay: 0.14, duration: 0.24, type: 'sawtooth', gain: 0.04, to: 164.81 }],
      ]);
      noise({ delay: 0.02, duration: 0.18, gain: 0.02, from: 400, to: 160 });
      break;
    case 'heartLost':
      noise({ duration: 0.22, gain: 0.06, from: 320, to: 90, q: 0.8 });
      tone(146.83, { duration: 0.26, type: 'sine', gain: 0.07, to: 98 });
      break;
    case 'outOfHearts':
      notes([
        [440, { duration: 0.16, type: 'triangle', gain: 0.06 }],
        [349.23, { delay: 0.15, duration: 0.18, type: 'triangle', gain: 0.055 }],
        [261.63, { delay: 0.32, duration: 0.3, type: 'triangle', gain: 0.05 }],
        [196, { delay: 0.54, duration: 0.5, type: 'sine', gain: 0.045 }],
      ]);
      break;
    case 'combo': {
      const step = Math.min(PENTATONIC.length - 1, Math.max(0, level - 1));
      const frequency = PENTATONIC[step]!;
      notes([
        [frequency, { duration: 0.07, type: 'square', gain: 0.03 }],
        [frequency * 1.5, { delay: 0.06, duration: 0.11, type: 'sine', gain: 0.05 }],
      ]);
      break;
    }
    case 'match':
      notes([
        [1318.51, { duration: 0.3, type: 'triangle', gain: 0.05 }],
        [1975.53, { duration: 0.22, type: 'sine', gain: 0.02 }],
      ]);
      break;
    case 'reveal':
      tone(520, { duration: 0.24, type: 'sine', gain: 0.05, to: 1240 });
      noise({ duration: 0.2, gain: 0.02, from: 600, to: 2400, q: 0.7 });
      break;
    case 'hint':
      notes([
        [1046.5, { duration: 0.08, type: 'triangle', gain: 0.04 }],
        [1318.51, { delay: 0.07, duration: 0.09, type: 'triangle', gain: 0.04 }],
        [1567.98, { delay: 0.14, duration: 0.12, type: 'triangle', gain: 0.035 }],
        [2093, { delay: 0.2, duration: 0.16, type: 'sine', gain: 0.025 }],
      ]);
      break;
    case 'coin':
      notes([
        [1567.98, { duration: 0.09, type: 'square', gain: 0.03 }],
        [2093, { delay: 0.06, duration: 0.14, type: 'square', gain: 0.025 }],
      ]);
      break;
    case 'buy':
      notes([
        [1046.5, { duration: 0.07, type: 'square', gain: 0.035 }],
        [1318.51, { delay: 0.06, duration: 0.08, type: 'square', gain: 0.03 }],
        [1567.98, { delay: 0.13, duration: 0.18, type: 'triangle', gain: 0.04 }],
        [2093, { delay: 0.2, duration: 0.2, type: 'sine', gain: 0.02 }],
      ]);
      break;
    case 'boost':
      tone(294, { duration: 0.5, type: 'sawtooth', gain: 0.045, to: 1174 });
      tone(587, { duration: 0.5, type: 'sine', gain: 0.03, to: 1568 });
      break;
    case 'freeze':
      notes([
        [1318.51, { duration: 0.4, type: 'sine', gain: 0.035 }],
        [1760, { delay: 0.05, duration: 0.5, type: 'sine', gain: 0.028 }],
        [2637, { delay: 0.1, duration: 0.6, type: 'sine', gain: 0.015 }],
      ]);
      break;
    case 'streak':
      noise({ duration: 0.4, gain: 0.05, from: 260, to: 1800, q: 0.6 });
      notes([
        [392, { duration: 0.28, type: 'triangle', gain: 0.045, to: 784 }],
        [587.33, { delay: 0.16, duration: 0.34, type: 'sine', gain: 0.04 }],
      ]);
      break;
    case 'dailyGoal':
      notes([
        [523.25, { duration: 0.14, type: 'triangle', gain: 0.06 }],
        [659.25, { delay: 0.12, duration: 0.14, type: 'triangle', gain: 0.055 }],
        [783.99, { delay: 0.24, duration: 0.16, type: 'triangle', gain: 0.05 }],
        [1046.5, { delay: 0.36, duration: 0.4, type: 'sine', gain: 0.045 }],
      ]);
      noise({ delay: 0.34, duration: 0.5, gain: 0.015, from: 2400, to: 5200, q: 0.5 });
      break;
    case 'levelUp':
      notes([
        [523.25, { duration: 0.12, type: 'square', gain: 0.035 }],
        [659.25, { delay: 0.11, duration: 0.12, type: 'square', gain: 0.035 }],
        [783.99, { delay: 0.22, duration: 0.12, type: 'square', gain: 0.035 }],
        [1046.5, { delay: 0.33, duration: 0.45, type: 'triangle', gain: 0.05 }],
        [1568, { delay: 0.45, duration: 0.5, type: 'sine', gain: 0.03 }],
      ]);
      break;
    case 'lessonStart':
      notes([
        [587.33, { duration: 0.12, type: 'triangle', gain: 0.05 }],
        [880, { delay: 0.11, duration: 0.2, type: 'triangle', gain: 0.05 }],
      ]);
      break;
    case 'complete':
      notes([
        [523.25, { duration: 0.14, type: 'triangle', gain: 0.06 }],
        [659.25, { delay: 0.12, duration: 0.14, type: 'triangle', gain: 0.06 }],
        [783.99, { delay: 0.24, duration: 0.16, type: 'triangle', gain: 0.055 }],
        [1046.5, { delay: 0.36, duration: 0.5, type: 'sine', gain: 0.05 }],
      ]);
      break;
    case 'perfect':
      notes([
        [523.25, { duration: 0.12, type: 'triangle', gain: 0.06 }],
        [659.25, { delay: 0.1, duration: 0.12, type: 'triangle', gain: 0.06 }],
        [783.99, { delay: 0.2, duration: 0.12, type: 'triangle', gain: 0.06 }],
        [1046.5, { delay: 0.3, duration: 0.14, type: 'triangle', gain: 0.06 }],
        [1318.51, { delay: 0.4, duration: 0.6, type: 'sine', gain: 0.05 }],
        [2093, { delay: 0.5, duration: 0.7, type: 'sine', gain: 0.02 }],
      ]);
      noise({ delay: 0.4, duration: 0.7, gain: 0.02, from: 2000, to: 6000, q: 0.5 });
      break;
    case 'fail':
      notes([
        [392, { duration: 0.22, type: 'sawtooth', gain: 0.04, to: 330 }],
        [311.13, { delay: 0.2, duration: 0.26, type: 'sawtooth', gain: 0.04, to: 262 }],
        [233.08, { delay: 0.44, duration: 0.5, type: 'sine', gain: 0.04, to: 175 }],
      ]);
      break;
    case 'unlock':
      notes([
        [880, { duration: 0.07, type: 'square', gain: 0.03 }],
        [1174.66, { delay: 0.08, duration: 0.3, type: 'triangle', gain: 0.05, to: 1760 }],
      ]);
      break;
    case 'error':
      notes([
        [180, { duration: 0.18, type: 'square', gain: 0.04 }],
        [150, { delay: 0.16, duration: 0.24, type: 'square', gain: 0.035 }],
      ]);
      break;
    case 'whoosh':
      noise({ duration: 0.28, gain: 0.035, from: 1800, to: 300, q: 0.6 });
      break;
  }
}

// ------------------------------------------------------------------ public API
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
  /** Plays one named effect. `level` scales sounds that climb (a combo). */
  play(name: SfxName, level = 1): void {
    if (!this.isEnabled()) return;
    try {
      playSound(name, level);
    } catch {
      // Audio is a garnish: a browser that refuses to make a sound must not
      // take the lesson down with it.
    }
  },
  /** Auditioning from the shop ignores the mute switch, because that is the point. */
  preview(name: SfxName): void {
    try {
      playSound(name, 1);
    } catch {
      // As above.
    }
  },
  // Named shorthands, so callers read as the event rather than the sound.
  correct(): void {
    this.play('correct');
  },
  incorrect(): void {
    this.play('wrong');
  },
  complete(): void {
    this.play('complete');
  },
};
