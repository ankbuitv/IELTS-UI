/**
 * Celebration effects: confetti, a floating XP number, a combo counter and a
 * tint across the screen.
 *
 * All four are decoration, so they follow the same rules: they are
 * `aria-hidden`, they are drawn with CSS transforms and a fixed set of
 * keyframes (no timers, no layout thrash), they clean themselves up by
 * unmounting, and they respect `prefers-reduced-motion` — a learner who has
 * asked for less motion gets the colour and the number, not the movement.
 *
 * Each effect is keyed by a "burst" number by the caller, so firing the same
 * effect twice in a row restarts the animation instead of being ignored.
 */
import { useMemo } from 'react';

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
export function Confetti({ burst, pieces = 28, tone = 'good' }: { burst: number; pieces?: number; tone?: 'good' | 'perfect' }) {
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
    <span className={`fx-confetti${tone === 'perfect' ? ' fx-confetti--perfect' : ''}`} aria-hidden="true">
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
  const glyph = tone === 'coin' ? '🪙' : tone === 'heart' ? (amount > 0 ? '❤️' : '💔') : '⚡';
  return (
    <span key={burst} className={`fx-float fx-float--${tone}`} aria-hidden="true">
      {glyph} {amount > 0 ? '+' : ''}
      {amount} {suffix}
    </span>
  );
}

/** "3 in a row" — appears at three and grows every answer after it. */
export function ComboBadge({ combo }: { combo: number }) {
  if (combo < 3) return null;
  return (
    <span key={combo} className="fx-combo" role="status">
      <b>×{combo}</b> in a row
    </span>
  );
}

/** A wash of colour over the whole lesson: green for a right answer, red for a wrong one. */
export function ScreenFlash({ burst, tone }: { burst: number; tone: 'good' | 'bad' | 'goal' | 'level' }) {
  if (burst <= 0) return null;
  return <span key={burst} className={`fx-flash fx-flash--${tone}`} aria-hidden="true" />;
}

/** The ring that pulses out of the streak flame when the streak grows. */
export function StreakPulse({ burst }: { burst: number }) {
  if (burst <= 0) return null;
  return <span key={burst} className="fx-streak" aria-hidden="true" />;
}
