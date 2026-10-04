/**
 * Bơ, the learning path's mascot — and the rest of the flock.
 *
 * An original creature — a round sprout-bird drawn in SVG, no third-party
 * character — that reacts to what just happened. It is the thing that makes a
 * lesson feel like a conversation rather than a form: it hops when the answer is
 * right, its shoulders drop when it is wrong, it looks up when it is thinking
 * and it is upside-down asleep when the learner has nothing left to do today.
 *
 * The mood is the only input, and every mood is legible at 56 px (the size used
 * in the lesson header) as well as at 190 px (the size on the path). Animation
 * carries the emotion and colour reinforces it, so it still reads for a learner
 * who has motion turned down: the CSS honours `prefers-reduced-motion`.
 *
 * One shape, many coats. A `variant` swaps the palette (and only the palette),
 * so the same creature can wear the site's brand red on the landing page, a
 * navy-and-red "scholar" coat with a book on the practice pages, and any of six
 * bright coats inside a lesson — a lesson that changes colour every few
 * questions feels alive without a second drawing to maintain. An `accessory`
 * adds one prop (a cap, a book, headphones, a pencil, a medal) for the places
 * where the creature is standing in for a subject.
 *
 * Gradient ids are generated per instance: two mascots on one page used to share
 * `url(#mascot-body)`, so whichever mounted first painted both — which is why a
 * red mascot could come out green.
 */
import { useId, type CSSProperties } from 'react';

export const MASCOT_MOODS = ['idle', 'happy', 'sad', 'wow', 'think', 'wave', 'sleep'] as const;
export type MascotMood = (typeof MASCOT_MOODS)[number];

export type MascotTone = 'plain' | 'good' | 'bad' | 'info';

/**
 * The flock. `sprout` is Bơ as she shipped; `brand` wears the colours of the
 * site's own mark; `scholar` is the IELTS-flavoured one (navy coat, red scarf,
 * a book under the wing). The rest exist so a lesson can change coat between
 * questions without inventing a new creature each time.
 */
export const MASCOT_VARIANTS = [
  'sprout',
  'brand',
  'scholar',
  'ocean',
  'sunset',
  'violet',
  'berry',
  'mint',
  'gold',
] as const;
export type MascotVariant = (typeof MASCOT_VARIANTS)[number];

/** Coats that rotate inside a lesson: bright, distinct, and none of them grey. */
export const LESSON_MASCOT_VARIANTS: readonly MascotVariant[] = [
  'sprout',
  'ocean',
  'sunset',
  'violet',
  'berry',
  'mint',
  'brand',
  'gold',
];

interface Palette {
  /** Body gradient, top to bottom. */
  body: [string, string];
  belly: [string, string];
  wing: [string, string];
  /** Stem, then the two leaves of the sprout. */
  sprout: [string, string, string];
  beak: string;
  feet: [string, string];
  cheek: string;
  /** Optional detail drawn on the coat: a scarf, a badge, a marking. */
  accent?: string;
}

const PALETTES: Record<MascotVariant, Palette> = {
  sprout: {
    body: ['#5fd39a', '#1f9d63'],
    belly: ['#f2fff8', '#d6f5e4'],
    wing: ['#1f8f5b', '#1a8253'],
    sprout: ['#2f9e5f', '#4cc483', '#3bb377'],
    beak: '#f5a623',
    feet: ['#f5a623', '#e3941a'],
    cheek: '#ff9fb0',
  },
  // The site's own mark: brand red on a warm white belly.
  brand: {
    body: ['#ff7a80', '#d3222b'],
    belly: ['#fff6f6', '#ffdfe1'],
    wing: ['#b21820', '#8c1219'],
    sprout: ['#e23a41', '#ff8f95', '#f0585f'],
    beak: '#ffc53d',
    feet: ['#ffc53d', '#f2a91c'],
    cheek: '#ffb3ba',
    accent: '#ffffff',
  },
  // IELTS-flavoured: navy coat, red scarf, gold beak — the exam hall one.
  scholar: {
    body: ['#4a6ea8', '#1b2a44'],
    belly: ['#f7faff', '#dbe6f7'],
    wing: ['#243d63', '#16233a'],
    sprout: ['#e23a41', '#f0585f', '#d3222b'],
    beak: '#ffc53d',
    feet: ['#ffc53d', '#f2a91c'],
    cheek: '#ff9fb0',
    accent: '#e23a41',
  },
  ocean: {
    body: ['#6cc7f5', '#1d6fc4'],
    belly: ['#f2fbff', '#d5ecfb'],
    wing: ['#1b62ae', '#15528f'],
    sprout: ['#12a594', '#4fd6c3', '#0b7d70'],
    beak: '#ffc53d',
    feet: ['#ffc53d', '#f2a91c'],
    cheek: '#ff9fb0',
  },
  sunset: {
    body: ['#ffc46b', '#f2760c'],
    belly: ['#fffaf0', '#ffe9c9'],
    wing: ['#d9650a', '#b04f05'],
    sprout: ['#e23a41', '#ff7a5c', '#c22f37'],
    beak: '#ffd25e',
    feet: ['#ffd25e', '#e8a92a'],
    cheek: '#ff8fa3',
  },
  violet: {
    body: ['#b79cf7', '#6b3fa8'],
    belly: ['#faf7ff', '#e7dcfb'],
    wing: ['#5c3494', '#472675'],
    sprout: ['#8f63f4', '#c3a9ff', '#6d43cc'],
    beak: '#ffc53d',
    feet: ['#ffc53d', '#f2a91c'],
    cheek: '#ff9fb0',
  },
  berry: {
    body: ['#ff9ec4', '#e0457f'],
    belly: ['#fff5fa', '#ffddea'],
    wing: ['#c93a70', '#a52c5b'],
    sprout: ['#7a4fe0', '#b79cf7', '#5a35b8'],
    beak: '#ffc53d',
    feet: ['#ffc53d', '#f2a91c'],
    cheek: '#ff7fa0',
  },
  mint: {
    body: ['#7fe3cd', '#12a594'],
    belly: ['#f3fffc', '#d5f5ee'],
    wing: ['#0f8f80', '#0b7d70'],
    sprout: ['#2f9e5f', '#63d39b', '#1f8f5b'],
    beak: '#f5a623',
    feet: ['#f5a623', '#e3941a'],
    cheek: '#ff9fb0',
  },
  gold: {
    body: ['#ffe08a', '#d99b00'],
    belly: ['#fffdf3', '#ffefc2'],
    wing: ['#c08800', '#9c6d00'],
    sprout: ['#e23a41', '#ffd25e', '#c22f37'],
    beak: '#f2760c',
    feet: ['#f2760c', '#d9650a'],
    cheek: '#ff9fb0',
    accent: '#fff6dc',
  },
};

export const MASCOT_ACCESSORIES = ['none', 'cap', 'book', 'headphones', 'pencil', 'medal', 'scarf'] as const;
export type MascotAccessory = (typeof MASCOT_ACCESSORIES)[number];

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

/** One prop the creature can hold or wear. Drawn last, so it always sits on top. */
function Accessory({ kind, palette }: { kind: MascotAccessory; palette: Palette }) {
  switch (kind) {
    case 'cap':
      return (
        <g className="mascot__prop">
          <path d="M60 6 92 17 60 28 28 17z" fill="#243550" />
          <path d="M44 22v9c0 3.4 7.2 6 16 6s16-2.6 16-6v-9l-16 5.4z" fill="#1b2a44" />
          <path d="M92 17v13" stroke="#ffc53d" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="92" cy="32" r="3.4" fill="#ffc53d" />
        </g>
      );
    case 'book':
      return (
        <g className="mascot__prop">
          <path d="M14 84h20a6 6 0 0 1 6 6v22a6 6 0 0 0-6-6H14z" fill={palette.wing[0]} />
          <path d="M40 90a6 6 0 0 1 6-6h20v28H46a6 6 0 0 0-6-6z" fill="#ffffff" stroke={palette.wing[1]} strokeWidth="2" />
          <path d="M50 92h12M50 98h12M50 104h8" stroke={palette.wing[1]} strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case 'headphones':
      return (
        <g className="mascot__prop">
          <path d="M30 58a30 30 0 0 1 60 0" fill="none" stroke={palette.wing[1]} strokeWidth="5" strokeLinecap="round" />
          <rect x="22" y="54" width="13" height="20" rx="6" fill={palette.wing[1]} />
          <rect x="85" y="54" width="13" height="20" rx="6" fill={palette.wing[1]} />
        </g>
      );
    case 'pencil':
      return (
        <g className="mascot__prop" transform="rotate(28 96 96)">
          <rect x="92" y="70" width="9" height="34" rx="2" fill="#ffc53d" />
          <path d="M92 104h9l-4.5 9z" fill="#f0d9a8" />
          <path d="M94.6 109.4h3.8l-1.9 3.6z" fill="#243550" />
          <rect x="92" y="66" width="9" height="6" rx="2" fill="#e23a41" />
        </g>
      );
    case 'medal':
      return (
        <g className="mascot__prop">
          <path d="M46 92 60 104 74 92" fill="none" stroke="#e23a41" strokeWidth="5" strokeLinecap="round" />
          <circle cx="60" cy="108" r="9" fill="#c98a00" />
          <circle cx="60" cy="108" r="7" fill="#ffd25e" />
          <path d="m60 103.6 1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z" fill="#c98a00" />
        </g>
      );
    case 'scarf':
      return (
        <g className="mascot__prop">
          <path d="M36 92q24 12 48 0l2 9q-26 12-52 0z" fill={palette.accent ?? '#e23a41'} />
          <path d="M74 96l6 18-9 2-4-17z" fill={palette.accent ?? '#e23a41'} opacity="0.85" />
        </g>
      );
    default:
      return null;
  }
}

export function Mascot({
  mood = 'idle',
  size = 120,
  message,
  tone = 'plain',
  className = '',
  variant = 'sprout',
  accessory = 'none',
  name = 'Bơ',
}: {
  mood?: MascotMood;
  size?: number;
  /** A line the mascot says; drawn in a speech bubble beside it. */
  message?: string;
  tone?: MascotTone;
  className?: string;
  /** Which coat it wears. Colours only — the drawing never changes. */
  variant?: MascotVariant;
  /** One prop: a cap, a book, headphones, a pencil, a medal or a scarf. */
  accessory?: MascotAccessory;
  /** Used in the accessible name; the flock shares a shape, not a name. */
  name?: string;
}) {
  // A stable, per-instance suffix: two mascots on one page must not share a
  // gradient id, or the second one is painted with the first one's colours.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const palette = PALETTES[variant] ?? PALETTES.sprout!;
  const bodyId = `mascot-body-${uid}`;
  const bellyId = `mascot-belly-${uid}`;

  return (
    <span
      className={`mascot mascot--${mood} mascot--${variant}${className ? ` ${className}` : ''}`}
      style={{ '--mascot-size': `${size}px` } as CSSProperties}
    >
      <svg className="mascot__art" viewBox="0 0 120 120" role="img" aria-label={`${name} the mascot, ${mood}`}>
        <defs>
          <linearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.body[0]} />
            <stop offset="100%" stopColor={palette.body[1]} />
          </linearGradient>
          <linearGradient id={bellyId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.belly[0]} />
            <stop offset="100%" stopColor={palette.belly[1]} />
          </linearGradient>
        </defs>

        {/* Shadow, so the creature sits on the page instead of floating over it. */}
        <ellipse className="mascot__shadow" cx="60" cy="110" rx="30" ry="6" fill="#1d2a38" opacity="0.1" />

        {/* The sprout on its head: the one detail that makes it a plant-bird. */}
        <g className="mascot__sprout">
          <path d="M60 40 C60 30 60 24 60 18" fill="none" stroke={palette.sprout[0]} strokeWidth="3.4" strokeLinecap="round" />
          <ellipse cx="50" cy="21" rx="9" ry="5.4" fill={palette.sprout[1]} transform="rotate(-24 50 21)" />
          <ellipse cx="70" cy="19" rx="9" ry="5.4" fill={palette.sprout[2]} transform="rotate(22 70 19)" />
        </g>

        {/* Wings sit behind the body and swing with the mood. */}
        <ellipse
          className="mascot__wing mascot__wing--left"
          cx="20"
          cy="72"
          rx="8.5"
          ry="14"
          fill={palette.wing[0]}
          transform="rotate(-14 20 72)"
        />
        <ellipse
          className="mascot__wing mascot__wing--right"
          cx="100"
          cy="72"
          rx="8.5"
          ry="14"
          fill={palette.wing[1]}
          transform="rotate(14 100 72)"
        />

        <g className="mascot__body">
          <ellipse cx="60" cy="70" rx="37" ry="35" fill={`url(#${bodyId})`} />
          <ellipse cx="60" cy="79" rx="24" ry="22" fill={`url(#${bellyId})`} />
          <circle cx="38" cy="77" r="6" fill={palette.cheek} opacity="0.5" />
          <circle cx="82" cy="77" r="6" fill={palette.cheek} opacity="0.5" />
          <Eyes mood={mood} />
          <path d="M55.5 72.5 h9 l-4.5 5.5 z" fill={palette.beak} />
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
          <rect x="45" y="100" width="12" height="8" rx="4" fill={palette.feet[0]} />
          <rect x="63" y="100" width="12" height="8" rx="4" fill={palette.feet[1]} />
        </g>

        <Accessory kind={accessory} palette={palette} />

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
 * A row of the flock, used where one creature is not enough: the finish screen
 * of a lesson, the empty states, the hero of the practice pages. Each one keeps
 * its own coat, which is the point — the row reads as a crowd, not a pattern.
 */
export function MascotRow({
  variants,
  size = 64,
  mood = 'happy',
  className = '',
}: {
  variants: readonly MascotVariant[];
  size?: number;
  mood?: MascotMood;
  className?: string;
}) {
  return (
    <span className={`mascot-row${className ? ` ${className}` : ''}`} aria-hidden="true">
      {variants.map((variant, index) => (
        <Mascot key={`${variant}-${index}`} variant={variant} mood={mood} size={size} className="mascot-row__one" />
      ))}
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
