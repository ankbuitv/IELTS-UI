/**
 * Celebration effects: confetti, a floating XP number, a combo counter, the
 * milestone banner a long run earns, and a tint across the screen.
 *
 * All of them are decoration, so they follow the same rules: they are
 * `aria-hidden` (except the two that announce themselves), they are drawn with
 * CSS transforms and a fixed set of keyframes (no timers, no layout thrash),
 * they clean themselves up by unmounting, and they respect
 * `prefers-reduced-motion` — a learner who has asked for less motion gets the
 * colour and the number, not the movement.
 *
 * Each effect is keyed by a "burst" number by the caller, so firing the same
 * effect twice in a row restarts the animation instead of being ignored.
 */
import { useMemo } from 'react';
import { Icon } from '../Icon';
import { Mascot, MascotSquad } from './Mascot';

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
  const iconName = tone === 'coin' ? 'coin' : tone === 'heart' ? 'heart' : 'bolt';
  return (
    <span key={burst} className={`fx-float fx-float--${tone}`} aria-hidden="true">
      <Icon name={iconName} size={14} filled={tone === 'heart' ? amount > 0 : tone === 'xp'} /> {amount > 0 ? '+' : ''}
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

// ------------------------------------------------------------------ milestone
/**
 * A run of five first-try answers — then ten, then fifteen and every five after
 * that — is a milestone rather than just a bigger badge, so it gets its own
 * three-second banner over the lesson: Bơ in its `wow` mood, the count, and one
 * line of encouragement, with two rings pushing out from behind the card.
 *
 * Three tiers, each a different colour and a bigger burst: gold at five, brand
 * red at ten, violet from fifteen up. The rule lives here, as a pure function,
 * so both the trigger (the lesson player) and the drawing read the same
 * definition — and so it can be tested without a browser.
 */
export interface ComboMilestoneInfo {
  /** 1 at ×5, 2 at ×10, 3 from ×15 upwards. */
  tier: 1 | 2 | 3;
  title: string;
  note: string;
}

const MILESTONE_TIERS: Record<1 | 2 | 3, { title: string; note: string }> = {
  1: { title: 'On a roll', note: 'Five straight answers — the run is alive.' },
  2: { title: 'On fire', note: 'Ten in a row. This is where lessons are won.' },
  3: { title: 'Unstoppable', note: 'Nothing is getting past you now.' },
};

/** The milestone a combo lands on, or `null` when it is not a multiple of five. */
export function comboMilestone(combo: number): ComboMilestoneInfo | null {
  if (!Number.isFinite(combo) || combo < 5 || combo % 5 !== 0) return null;
  const tier: 1 | 2 | 3 = combo >= 15 ? 3 : combo >= 10 ? 2 : 1;
  return { tier, ...MILESTONE_TIERS[tier] };
}

/** How much confetti a tier's banner drops: 68 / 96 / 124 pieces. */
export function comboMilestoneConfetti(tier: 1 | 2 | 3): number {
  return 40 + tier * 28;
}

/** The banner itself; `burst` is the caller's counter, so zero means "never fired". */
export function ComboMilestone({ burst, combo }: { burst: number; combo: number }) {
  const info = comboMilestone(combo);
  if (burst <= 0 || !info) return null;
  return (
    <div key={burst} className={`fx-milestone fx-milestone--t${info.tier}`} role="status">
      {/* The banner brings its own confetti: it falls across the whole screen,
          under the card, and the tier decides how much of it there is. */}
      <Confetti burst={burst} pieces={comboMilestoneConfetti(info.tier)} tone={info.tier >= 3 ? 'perfect' : 'good'} />
      <span className="fx-milestone__ring" aria-hidden="true" />
      <span className="fx-milestone__ring fx-milestone__ring--late" aria-hidden="true" />
      <div className="fx-milestone__card">
        <span className="fx-milestone__mascot" aria-hidden="true">
          <Mascot variant="crown" mood="wow" size={76} />
          <MascotSquad variants={['brand', 'reading', 'listening', 'speaking']} mood="happy" size={38} />
        </span>
        <span className="fx-milestone__title">{info.title}</span>
        <b className="fx-milestone__count">
          ×{combo} <em>in a row</em>
        </b>
        <span className="fx-milestone__note">{info.note}</span>
      </div>
    </div>
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
