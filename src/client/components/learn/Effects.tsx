/**
 * Celebration effects: confetti, a floating XP number, a combo counter, a
 * milestone burst and a tint across the screen.
 *
 * All of them are decoration, so they follow the same rules: they are
 * `aria-hidden` (or a `role="status"` with real text when they announce
 * something), they are drawn with CSS transforms and a fixed set of keyframes
 * (no timers, no layout thrash), they clean themselves up by unmounting, and
 * they respect `prefers-reduced-motion` — a learner who has asked for less
 * motion gets the colour and the number, not the movement.
 *
 * Nothing here is an emoji. The coin, the heart and the bolt used to be 🪙 ❤️ ⚡,
 * which is fine on a phone and an empty box on a machine without a colour emoji
 * font; they are the same SVG icons the rest of the product uses now.
 *
 * Each effect is keyed by a "burst" number by the caller, so firing the same
 * effect twice in a row restarts the animation instead of being ignored.
 */
import { useMemo } from 'react';
import { Icon } from '../Icon';

const CONFETTI_COLOURS = ['#e23a41', '#ffc53d', '#2f9e5f', '#3f7bff', '#a45cf0', '#ff8fa3'];

function seeded(seed: number): () => number {
  // A tiny deterministic generator, so a burst's confetti is stable while it is
  // on screen (a re-render must not make the pieces jump).
  let state = (seed * 2654435761) % 4294967296;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * A short fall of paper, from the top of the nearest positioned ancestor.
 *
 * `burst` is a counter the caller bumps to fire the effect, so zero means "it
 * has never been fired" — and the component renders nothing, rather than
 * raining confetti on a page that has just loaded.
 */
export function Confetti({
  burst,
  pieces = 28,
  tone = 'good',
}: {
  burst: number;
  pieces?: number;
  tone?: 'good' | 'perfect' | 'combo';
}) {
  const particles = useMemo(() => {
    const random = seeded(burst + 1);
    return Array.from({ length: pieces }, (_, index) => ({
      key: `${burst}-${index}`,
      left: 4 + random() * 92,
      delay: random() * 0.25,
      duration: 0.9 + random() * 0.7,
      size: 6 + random() * 7,
      colour: CONFETTI_COLOURS[Math.floor(random() * CONFETTI_COLOURS.length)]!,
      round: random() > 0.6,
      spin: Math.round(random() * 540 - 270),
    }));
  }, [burst, pieces]);

  if (burst <= 0) return null;

  return (
    <span className={`fx-confetti${tone === 'perfect' ? ' fx-confetti--perfect' : ''}${tone === 'combo' ? ' fx-confetti--combo' : ''}`} aria-hidden="true">
      {particles.map((particle) => (
        <i
          key={particle.key}
          style={{
            left: `${particle.left}%`,
            background: particle.colour,
            width: particle.size,
            height: particle.size * (particle.round ? 1 : 0.55),
            borderRadius: particle.round ? '50%' : 2,
            animationDelay: `${particle.delay}s`,
            animationDuration: `${particle.duration}s`,
            ['--spin' as string]: `${particle.spin}deg`,
          }}
        />
      ))}
    </span>
  );
}

/** A coin or XP number that rises and fades where it was earned. */
export function FloatingAward({
  burst,
  amount,
  suffix = 'XP',
  tone = 'xp',
}: {
  burst: number;
  amount: number;
  suffix?: string;
  tone?: 'xp' | 'coin' | 'heart';
}) {
  if (amount === 0) return null;
  const icon = tone === 'coin' ? 'coin' : tone === 'heart' ? (amount > 0 ? 'heart' : 'heartCrack') : 'bolt';
  return (
    <span key={burst} className={`fx-float fx-float--${tone}`} aria-hidden="true">
      <Icon name={icon} size={14} filled={tone === 'heart'} />
      {amount > 0 ? '+' : ''}
      {amount} {suffix}
    </span>
  );
}

/** "3 in a row" — appears at three and grows every answer after it. */
export function ComboBadge({ combo }: { combo: number }) {
  if (combo < 3) return null;
  return (
    <span key={combo} className={`fx-combo${combo >= 5 ? ' fx-combo--hot' : ''}`} role="status">
      <Icon name="combo" size={13} filled />
      <b>×{combo}</b> in a row
    </span>
  );
}

/**
 * The milestone tiers of a run of correct answers.
 *
 * Three in a row is a badge; five, ten, fifteen and twenty are an event. Each
 * tier has its own colour, its own word and its own burst, so a learner who is
 * on a roll can feel the run getting rarer rather than watching a number climb.
 */
export const COMBO_TIERS: ReadonlyArray<{ at: number; label: string; note: string; pieces: number }> = [
  { at: 5, label: 'On fire', note: 'Five in a row — you are reading, not guessing.', pieces: 40 },
  { at: 10, label: 'Unstoppable', note: 'Ten in a row. This lesson is yours.', pieces: 70 },
  { at: 15, label: 'Legendary', note: 'Fifteen without a miss. Take a breath.', pieces: 100 },
  { at: 20, label: 'Perfect storm', note: 'Twenty in a row — nothing has touched you.', pieces: 130 },
];

/** The tier a combo count has just reached, or null when it is an ordinary one. */
export function comboTier(combo: number): { at: number; label: string; note: string; pieces: number } | null {
  return COMBO_TIERS.find((tier) => tier.at === combo) ?? null;
}

/**
 * The full-screen banner for a combo milestone.
 *
 * It arrives with the ring, the confetti and the sound, stays for about a
 * second and unmounts itself, so it can never sit over an answer the learner is
 * trying to read. `burst` is what restarts it; a tier is only fired on the
 * answer that reaches it exactly, so it never repeats on the way past.
 */
export function ComboBurst({ combo, burst }: { combo: number; burst: number }) {
  const tier = burst > 0 ? comboTier(combo) : null;
  if (!tier) return null;
  return (
    <span key={burst} className="fx-burst" role="status" aria-live="assertive">
      <Confetti burst={burst} pieces={tier.pieces} tone="combo" />
      <span className="fx-burst__ring" aria-hidden="true" />
      <span className="fx-burst__card">
        <Icon name="combo" size={26} filled />
        <b>×{combo}</b>
        <span>{tier.label}</span>
      </span>
    </span>
  );
}

/** A wash of colour over the whole lesson: green for a right answer, red for a wrong one. */
export function ScreenFlash({ burst, tone }: { burst: number; tone: 'good' | 'bad' | 'goal' | 'level' | 'combo' }) {
  if (burst <= 0) return null;
  return <span key={burst} className={`fx-flash fx-flash--${tone}`} aria-hidden="true" />;
}

/** The ring that pulses out of the streak flame when the streak grows. */
export function StreakPulse({ burst }: { burst: number }) {
  if (burst <= 0) return null;
  return <span key={burst} className="fx-streak" aria-hidden="true" />;
}
