/**
 * Bơ, the learning path's mascot.
 *
 * An original creature — a round green sprout-bird drawn in SVG, no third-party
 * character — that reacts to what just happened. It is the thing that makes a
 * lesson feel like a conversation rather than a form: it hops when the answer is
 * right, its shoulders drop when it is wrong, it looks up when it is thinking
 * and it is upside-down asleep when the learner has nothing left to do today.
 *
 * The mood is the only input, and every mood is legible at 56 px (the size used
 * in the lesson header) as well as at 190 px (the size on the path). Animation
 * carries the emotion and colour reinforces it, so it still reads for a learner
 * who has motion turned down: the CSS honours `prefers-reduced-motion`.
 */
import type { CSSProperties } from 'react';

export const MASCOT_MOODS = ['idle', 'happy', 'sad', 'wow', 'think', 'wave', 'sleep'] as const;
export type MascotMood = (typeof MASCOT_MOODS)[number];

export type MascotTone = 'plain' | 'good' | 'bad' | 'info';

const TONE_CLASS: Record<MascotTone, string> = {
  plain: '',
  good: ' mascot__bubble--good',
  bad: ' mascot__bubble--bad',
  info: ' mascot__bubble--info',
};

/** Eyes, per mood. Kept as paths so they scale with the viewBox and can be animated. */
function Eyes({ mood }: { mood: MascotMood }) {
  const stroke = { fill: 'none', stroke: '#1d2a38', strokeWidth: 2.4, strokeLinecap: 'round' as const };
  if (mood === 'happy' || mood === 'wow') {
    return (
      <g>
        <path d="M40 62 q8 -9 16 0" {...stroke} />
        <path d="M64 62 q8 -9 16 0" {...stroke} />
      </g>
    );
  }
  if (mood === 'sleep') {
    return (
      <g>
        <path d="M41 63 h14" {...stroke} />
        <path d="M65 63 h14" {...stroke} />
      </g>
    );
  }
  if (mood === 'sad') {
    return (
      <g>
        <circle cx="48" cy="63" r="8.6" fill="#ffffff" />
        <circle cx="72" cy="63" r="8.6" fill="#ffffff" />
        <circle cx="48" cy="66" r="4" fill="#2b3b4c" />
        <circle cx="72" cy="66" r="4" fill="#2b3b4c" />
        <path d="M39 54 q9 -4 17 -1" {...stroke} />
        <path d="M64 53 q9 -3 17 1" {...stroke} />
        {/* A tear that the CSS lets fall. */}
        <path className="mascot__tear" d="M78 70 q3 5 0 8 q-3 -3 0 -8" fill="#8fd0ff" />
      </g>
    );
  }
  // idle, think, wave: round eyes; `think` looks to the side.
  const shift = mood === 'think' ? 2.4 : 0;
  return (
    <g>
      <circle cx="48" cy="62" r="9" fill="#ffffff" />
      <circle cx="72" cy="62" r="9" fill="#ffffff" />
      <circle cx={48 + shift} cy="62" r="4.4" fill="#2b3b4c" />
      <circle cx={72 + shift} cy="62" r="4.4" fill="#2b3b4c" />
      <circle cx={46.6 + shift} cy="60.2" r="1.4" fill="#ffffff" />
      <circle cx={70.6 + shift} cy="60.2" r="1.4" fill="#ffffff" />
    </g>
  );
}

function Mouth({ mood }: { mood: MascotMood }) {
  const stroke = { fill: 'none', stroke: '#1d2a38', strokeWidth: 2.4, strokeLinecap: 'round' as const };
  if (mood === 'wow') {
    return (
      <g>
        <ellipse cx="60" cy="80" rx="7" ry="8.5" fill="#1d2a38" />
        <ellipse cx="60" cy="83" rx="4" ry="4" fill="#f06a7f" />
      </g>
    );
  }
  if (mood === 'happy') {
    return (
      <g>
        <path d="M48 76 q12 14 24 0" fill="#1d2a38" />
        <path d="M52 84 q8 6 16 0" fill="#f06a7f" opacity="0.85" />
      </g>
    );
  }
  if (mood === 'sad') {
    return <path d="M50 84 q10 -9 20 0" {...stroke} />;
  }
  if (mood === 'sleep') {
    return <path d="M54 80 q6 4 12 0" {...stroke} />;
  }
  return <path d="M53 79 q7 6 14 0" {...stroke} />;
}

export function Mascot({
  mood = 'idle',
  size = 120,
  message,
  tone = 'plain',
  className = '',
}: {
  mood?: MascotMood;
  size?: number;
  /** A line the mascot says; drawn in a speech bubble beside it. */
  message?: string;
  tone?: MascotTone;
  className?: string;
}) {
  return (
    <span
      className={`mascot mascot--${mood}${className ? ` ${className}` : ''}`}
      style={{ '--mascot-size': `${size}px` } as CSSProperties}
    >
      <svg className="mascot__art" viewBox="0 0 120 120" role="img" aria-label={`Bơ the mascot, ${mood}`}>
        <defs>
          <linearGradient id="mascot-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5fd39a" />
            <stop offset="100%" stopColor="#1f9d63" />
          </linearGradient>
          <linearGradient id="mascot-belly" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f2fff8" />
            <stop offset="100%" stopColor="#d6f5e4" />
          </linearGradient>
        </defs>

        {/* Shadow, so the creature sits on the page instead of floating over it. */}
        <ellipse className="mascot__shadow" cx="60" cy="110" rx="30" ry="6" fill="#1d2a38" opacity="0.1" />

        {/* The sprout on its head: the one detail that makes it a plant-bird. */}
        <g className="mascot__sprout">
          <path d="M60 40 C60 30 60 24 60 18" fill="none" stroke="#2f9e5f" strokeWidth="3.4" strokeLinecap="round" />
          <ellipse cx="50" cy="21" rx="9" ry="5.4" fill="#4cc483" transform="rotate(-24 50 21)" />
          <ellipse cx="70" cy="19" rx="9" ry="5.4" fill="#3bb377" transform="rotate(22 70 19)" />
        </g>

        {/* Wings sit behind the body and swing with the mood. */}
        <ellipse className="mascot__wing mascot__wing--left" cx="20" cy="72" rx="8.5" ry="14" fill="#1f8f5b" transform="rotate(-14 20 72)" />
        <ellipse className="mascot__wing mascot__wing--right" cx="100" cy="72" rx="8.5" ry="14" fill="#1a8253" transform="rotate(14 100 72)" />

        <g className="mascot__body">
          <ellipse cx="60" cy="70" rx="37" ry="35" fill="url(#mascot-body)" />
          <ellipse cx="60" cy="79" rx="24" ry="22" fill="url(#mascot-belly)" />
          <circle cx="38" cy="77" r="6" fill="#ff9fb0" opacity="0.5" />
          <circle cx="82" cy="77" r="6" fill="#ff9fb0" opacity="0.5" />
          <Eyes mood={mood} />
          <path d="M55.5 72.5 h9 l-4.5 5.5 z" fill="#f5a623" />
          <Mouth mood={mood} />
          {mood === 'think' ? (
            <text className="mascot__mark" x="96" y="40" fontSize="20" fill="#5b6b80" fontWeight="700">
              ?
            </text>
          ) : null}
          {mood === 'sleep' ? (
            <text className="mascot__mark mascot__mark--zzz" x="94" y="42" fontSize="16" fill="#7b8aa0" fontWeight="700">
              z z
            </text>
          ) : null}
        </g>

        <g className="mascot__feet">
          <rect x="45" y="100" width="12" height="8" rx="4" fill="#f5a623" />
          <rect x="63" y="100" width="12" height="8" rx="4" fill="#e3941a" />
        </g>

        {mood === 'wow' ? (
          <g className="mascot__sparkles" fill="#ffd75e">
            <path d="M22 34 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" />
            <path d="M100 30 l2.4 5.6 l5.6 2.4 l-5.6 2.4 l-2.4 5.6 l-2.4 -5.6 l-5.6 -2.4 l5.6 -2.4 z" opacity="0.85" />
          </g>
        ) : null}
        {mood === 'happy' ? (
          <g className="mascot__sparkles" fill="#ffd75e">
            <path d="M18 40 l2.6 6 l6 2.6 l-6 2.6 l-2.6 6 l-2.6 -6 l-6 -2.6 l6 -2.6 z" />
          </g>
        ) : null}
      </svg>
      {message ? (
        <span className={`mascot__bubble${TONE_CLASS[tone]}`} role="status">
          {message}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The mascot's reaction to one answer.
 *
 * Exported as a function so the lesson player and the review player describe
 * the same verdicts with the same creature, and a new place that shows feedback
 * cannot invent a fourth way of saying "nearly".
 */
export function reactionTo(verdict: { correct: boolean; almost?: boolean } | null): {
  mood: MascotMood;
  message: string;
  tone: MascotTone;
} {
  if (!verdict) return { mood: 'think', message: 'Take your time. Read it once more.', tone: 'plain' };
  if (verdict.correct && verdict.almost) return { mood: 'wow', message: 'Almost perfect — mind the spelling!', tone: 'info' };
  if (verdict.correct) return { mood: 'happy', message: 'Yes! That is right.', tone: 'good' };
  return { mood: 'sad', message: 'Not yet. Look at the answer, then try the next one.', tone: 'bad' };
}
