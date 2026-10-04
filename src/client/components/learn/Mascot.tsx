/**
 * Mascot cast: the website's brand creature ("Ai eo") plus the IELTS skill
 * companions (Reading, Listening, Writing, Speaking, Scholar, Champion and Bơ).
 *
 * Every creature is drawn in inline SVG with per-variant gradients (never a
 * shared global `<linearGradient id>`), so a page or lesson can put several
 * creatures of different colours on screen at once without their palettes
 * colliding.
 *
 * Props:
 *   - `variant`: which character/colour to draw (`'brand'` uses the website's
 *     crimson + navy logo palette and 3-bar crest; `'reading'`, `'listening'`,
 *     `'writing'`, `'speaking'`, `'scholar'`, `'crown'` and `'bo'` represent
 *     the IELTS skills and milestones).
 *   - `look`: `'center' | 'right' | 'left'` — shifts the pupils and posture so
 *     a mascot parked on the left of a lesson looks across at the passage and
 *     questions (`look="right"`).
 */
import type { CSSProperties } from 'react';

export const MASCOT_MOODS = ['idle', 'happy', 'sad', 'wow', 'think', 'wave', 'sleep'] as const;
export type MascotMood = (typeof MASCOT_MOODS)[number];

export const MASCOT_VARIANTS = [
  'brand',
  'bo',
  'reading',
  'listening',
  'writing',
  'speaking',
  'scholar',
  'crown',
] as const;
export type MascotVariant = (typeof MASCOT_VARIANTS)[number];

export type MascotLook = 'center' | 'right' | 'left';
export type MascotTone = 'plain' | 'good' | 'bad' | 'info';

interface VariantPalette {
  name: string;
  bodyTop: string;
  bodyBottom: string;
  bellyTop: string;
  bellyBottom: string;
  wingLeft: string;
  wingRight: string;
  cheek: string;
  beak: string;
  feetA: string;
  feetB: string;
}

export const MASCOT_PALETTES: Record<MascotVariant, VariantPalette> = {
  /** Website brand mascot: crimson red + deep navy (`ai eo` logo palette). */
  brand: {
    name: 'Ai eo',
    bodyTop: '#ff574d',
    bodyBottom: '#d9251b',
    bellyTop: '#fff7f6',
    bellyBottom: '#ffe1de',
    wingLeft: '#14233a',
    wingRight: '#0f1c31',
    cheek: '#fda4af',
    beak: '#f5a623',
    feetA: '#f5a623',
    feetB: '#d9820b',
  },
  /** Classic emerald sprout. */
  bo: {
    name: 'Bơ',
    bodyTop: '#5fd39a',
    bodyBottom: '#1f9d63',
    bellyTop: '#f2fff8',
    bellyBottom: '#d6f5e4',
    wingLeft: '#1f8f5b',
    wingRight: '#1a8253',
    cheek: '#ff9fb0',
    beak: '#f5a623',
    feetA: '#f5a623',
    feetB: '#e3941a',
  },
  /** IELTS Reading: sapphire blue with round reading glasses. */
  reading: {
    name: 'Reader',
    bodyTop: '#60a5fa',
    bodyBottom: '#2563eb',
    bellyTop: '#f5f9ff',
    bellyBottom: '#dbeafe',
    wingLeft: '#1d4ed8',
    wingRight: '#1e40af',
    cheek: '#f9a8d4',
    beak: '#f59e0b',
    feetA: '#f59e0b',
    feetB: '#d97706',
  },
  /** IELTS Listening: vibrant teal with studio headphones. */
  listening: {
    name: 'Listener',
    bodyTop: '#2dd4bf',
    bodyBottom: '#0d9488',
    bellyTop: '#f0fdfa',
    bellyBottom: '#ccfbf1',
    wingLeft: '#0f766e',
    wingRight: '#115e59',
    cheek: '#fda4af',
    beak: '#f59e0b',
    feetA: '#f59e0b',
    feetB: '#d97706',
  },
  /** IELTS Writing: warm amber-gold scribe with quill crest. */
  writing: {
    name: 'Scribe',
    bodyTop: '#fbbf24',
    bodyBottom: '#d97706',
    bellyTop: '#fffbeb',
    bellyBottom: '#fef3c7',
    wingLeft: '#b45309',
    wingRight: '#92400e',
    cheek: '#fb7185',
    beak: '#ea580c',
    feetA: '#ea580c',
    feetB: '#c2410c',
  },
  /** IELTS Speaking: vivid violet orator with mic crest. */
  speaking: {
    name: 'Orator',
    bodyTop: '#a78bfa',
    bodyBottom: '#7c3aed',
    bellyTop: '#f5f3ff',
    bellyBottom: '#ede9fe',
    wingLeft: '#6d28d9',
    wingRight: '#5b21b6',
    cheek: '#f472b6',
    beak: '#f59e0b',
    feetA: '#f59e0b',
    feetB: '#d97706',
  },
  /** IELTS Scholar: sky-indigo graduate wearing a mortarboard cap. */
  scholar: {
    name: 'Scholar',
    bodyTop: '#38bdf8',
    bodyBottom: '#0284c7',
    bellyTop: '#f0f9ff',
    bellyBottom: '#e0f2fe',
    wingLeft: '#0369a1',
    wingRight: '#075985',
    cheek: '#fda4af',
    beak: '#f59e0b',
    feetA: '#f59e0b',
    feetB: '#d97706',
  },
  /** IELTS Band-9 Champion: rose-magenta with a golden crown. */
  crown: {
    name: 'Champion',
    bodyTop: '#fb7185',
    bodyBottom: '#e11d48',
    bellyTop: '#fff1f2',
    bellyBottom: '#ffe4e6',
    wingLeft: '#be123c',
    wingRight: '#9f1239',
    cheek: '#fde047',
    beak: '#f59e0b',
    feetA: '#f59e0b',
    feetB: '#d97706',
  },
};

const TONE_CLASS: Record<MascotTone, string> = {
  plain: '',
  good: ' mascot__bubble--good',
  bad: ' mascot__bubble--bad',
  info: ' mascot__bubble--info',
};

/** Eyes, per mood and gaze direction. */
function Eyes({ mood, look }: { mood: MascotMood; look: MascotLook }) {
  const stroke = { fill: 'none', stroke: '#1d2a38', strokeWidth: 2.4, strokeLinecap: 'round' as const };
  const lookShift = look === 'right' ? 3.2 : look === 'left' ? -3.2 : 0;

  if (mood === 'happy' || mood === 'wow') {
    return (
      <g transform={lookShift ? `translate(${lookShift * 0.5} 0)` : undefined}>
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
        <circle cx={48 + lookShift * 0.6} cy="66" r="4" fill="#2b3b4c" />
        <circle cx={72 + lookShift * 0.6} cy="66" r="4" fill="#2b3b4c" />
        <path d="M39 54 q9 -4 17 -1" {...stroke} />
        <path d="M64 53 q9 -3 17 1" {...stroke} />
        <path className="mascot__tear" d="M78 70 q3 5 0 8 q-3 -3 0 -8" fill="#8fd0ff" />
      </g>
    );
  }
  const shift = lookShift !== 0 ? lookShift : mood === 'think' ? 2.4 : 0;
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

/** Headgear / IELTS skill accessory per mascot variant. */
function Headgear({ variant }: { variant: MascotVariant }) {
  switch (variant) {
    case 'brand':
      // The 3 rounded bars + dot of the `ai eo` website logo as a crown crest.
      return (
        <g className="mascot__sprout">
          <rect x="46" y="21" width="6" height="14" rx="3" fill="#14233a" />
          <circle cx="49" cy="15" r="3" fill="#e1251b" />
          <rect x="57" y="11" width="6.5" height="24" rx="3.2" fill="#e1251b" />
          <rect x="68" y="16" width="6" height="19" rx="3" fill="#14233a" />
        </g>
      );
    case 'scholar':
      // IELTS academic mortarboard (graduation cap + gold tassel).
      return (
        <g className="mascot__sprout">
          <polygon points="60,12 30,24 60,35 90,24" fill="#14233a" />
          <rect x="44" y="30" width="32" height="8" rx="3" fill="#1e3a5f" />
          <path d="M60 23 L82 28 L82 40" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="82" cy="41" r="3" fill="#fbbf24" />
        </g>
      );
    case 'reading':
      // Open book crest above the head (round glasses are drawn over the eyes).
      return (
        <g className="mascot__sprout">
          <path d="M44 26 Q52 20 60 25 Q68 20 76 26 L76 36 Q68 31 60 36 Q52 31 44 36 Z" fill="#ffffff" stroke="#1e40af" strokeWidth="2.4" />
          <line x1="60" y1="25" x2="60" y2="36" stroke="#1e40af" strokeWidth="2.2" />
        </g>
      );
    case 'listening':
      // Studio headphone band + ear cups on the sides of the body.
      return (
        <g className="mascot__sprout">
          <path d="M24 64 A36 36 0 0 1 96 64" fill="none" stroke="#14233a" strokeWidth="5.5" strokeLinecap="round" />
          <rect x="16" y="54" width="11" height="22" rx="5.5" fill="#14233a" stroke="#5eead4" strokeWidth="2" />
          <rect x="93" y="54" width="11" height="22" rx="5.5" fill="#14233a" stroke="#5eead4" strokeWidth="2" />
        </g>
      );
    case 'writing':
      // Golden fountain-pen nib & feather plume.
      return (
        <g className="mascot__sprout">
          <path d="M60 37 C58 24 66 13 76 11 C74 22 68 31 60 37 Z" fill="#fef3c7" stroke="#92400e" strokeWidth="2.2" />
          <circle cx="65" cy="25" r="2" fill="#92400e" />
        </g>
      );
    case 'speaking':
      // Broadcast microphone antenna + star spark.
      return (
        <g className="mascot__sprout">
          <rect x="54" y="12" width="12" height="17" rx="6" fill="#14233a" stroke="#ddd6fe" strokeWidth="2" />
          <path d="M50 22 a10 10 0 0 0 20 0" fill="none" stroke="#4c1d95" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="60" y1="32" x2="60" y2="38" stroke="#4c1d95" strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case 'crown':
      // Three-point golden Band 9 crown.
      return (
        <g className="mascot__sprout">
          <polygon
            points="40,35 44,16 54,26 60,12 66,26 76,16 80,35"
            fill="#fbbf24"
            stroke="#b45309"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <circle cx="60" cy="24" r="2.4" fill="#e11d48" />
        </g>
      );
    default:
      // Classic green sprout.
      return (
        <g className="mascot__sprout">
          <path d="M60 40 C60 30 60 24 60 18" fill="none" stroke="#2f9e5f" strokeWidth="3.4" strokeLinecap="round" />
          <ellipse cx="50" cy="21" rx="9" ry="5.4" fill="#4cc483" transform="rotate(-24 50 21)" />
          <ellipse cx="70" cy="19" rx="9" ry="5.4" fill="#3bb377" transform="rotate(22 70 19)" />
        </g>
      );
  }
}

export function Mascot({
  mood = 'idle',
  variant = 'bo',
  look = 'center',
  size = 120,
  message,
  tone = 'plain',
  className = '',
}: {
  mood?: MascotMood;
  variant?: MascotVariant;
  look?: MascotLook;
  size?: number;
  /** A line the mascot says; drawn in a speech bubble beside it. */
  message?: string;
  tone?: MascotTone;
  className?: string;
}) {
  const palette = MASCOT_PALETTES[variant] ?? MASCOT_PALETTES.bo;
  const bodyGradId = `mascot-body-${variant}`;
  const bellyGradId = `mascot-belly-${variant}`;

  return (
    <span
      className={`mascot mascot--${mood} mascot--v-${variant}${look !== 'center' ? ` mascot--look-${look}` : ''}${className ? ` ${className}` : ''}`}
      style={{ '--mascot-size': `${size}px` } as CSSProperties}
    >
      <svg className="mascot__art" viewBox="0 0 120 120" role="img" aria-label={`${palette.name} mascot, ${mood}`}>
        <defs>
          <linearGradient id={bodyGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.bodyTop} />
            <stop offset="100%" stopColor={palette.bodyBottom} />
          </linearGradient>
          <linearGradient id={bellyGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.bellyTop} />
            <stop offset="100%" stopColor={palette.bellyBottom} />
          </linearGradient>
        </defs>

        <ellipse className="mascot__shadow" cx="60" cy="110" rx="30" ry="6" fill="#1d2a38" opacity="0.1" />

        <ellipse className="mascot__wing mascot__wing--left" cx="20" cy="72" rx="8.5" ry="14" fill={palette.wingLeft} transform="rotate(-14 20 72)" />
        <ellipse className="mascot__wing mascot__wing--right" cx="100" cy="72" rx="8.5" ry="14" fill={palette.wingRight} transform="rotate(14 100 72)" />

        <g className="mascot__body">
          <ellipse cx="60" cy="70" rx="37" ry="35" fill={`url(#${bodyGradId})`} />
          <ellipse cx="60" cy="79" rx="24" ry="22" fill={`url(#${bellyGradId})`} />
          <circle cx="38" cy="77" r="6" fill={palette.cheek} opacity="0.55" />
          <circle cx="82" cy="77" r="6" fill={palette.cheek} opacity="0.55" />
          <Eyes mood={mood} look={look} />
          {variant === 'reading' ? (
            // Round scholar glasses for the IELTS Reading mascot.
            <g fill="none" stroke="#1e293b" strokeWidth="2.3">
              <circle cx="48" cy="62" r="11" />
              <circle cx="72" cy="62" r="11" />
              <line x1="59" y1="62" x2="61" y2="62" />
            </g>
          ) : null}
          {variant === 'brand' ? (
            // Subtle 3-bar `ai eo` emblem on the belly of the website brand mascot.
            <g opacity="0.88" transform="translate(51 87)">
              <rect x="0" y="5" width="3.2" height="7" rx="1.6" fill="#e1251b" />
              <circle cx="1.6" cy="2" r="1.6" fill="#e1251b" />
              <rect x="6" y="0" width="3.2" height="12" rx="1.6" fill="#14233a" />
              <rect x="12" y="3" width="3.2" height="9" rx="1.6" fill="#e1251b" />
            </g>
          ) : null}
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

        <Headgear variant={variant} />

        <g className="mascot__feet">
          <rect x="45" y="100" width="12" height="8" rx="4" fill={palette.feetA} />
          <rect x="63" y="100" width="12" height="8" rx="4" fill={palette.feetB} />
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
 * Picks the lead mascot and two colourful companions for an exercise in a
 * lesson, so every question has an IELTS-themed character on the left looking
 * at the prompt plus a lively squad of other colours cheering alongside.
 */
export function mascotCastForExercise(
  kind: string,
  index = 0,
): {
  lead: MascotVariant;
  buddies: [MascotVariant, MascotVariant];
  badge: string;
} {
  const cycle: MascotVariant[] = ['brand', 'reading', 'listening', 'writing', 'speaking', 'scholar', 'crown', 'bo'];
  const pickBuddies = (lead: MascotVariant): [MascotVariant, MascotVariant] => {
    const others = cycle.filter((item) => item !== lead);
    const a = others[index % others.length]!;
    const b = others[(index + 3) % others.length]!;
    return [a, b];
  };

  switch (kind) {
    case 'read':
      return { lead: 'reading', buddies: ['scholar', 'brand'], badge: 'IELTS Reading' };
    case 'listen':
      return { lead: 'listening', buddies: ['brand', 'speaking'], badge: 'IELTS Listening' };
    case 'write':
    case 'type':
    case 'order':
      return { lead: 'writing', buddies: ['reading', 'scholar'], badge: 'IELTS Writing' };
    case 'speak':
      return { lead: 'speaking', buddies: ['listening', 'crown'], badge: 'IELTS Speaking' };
    case 'paraphrase':
      return { lead: 'scholar', buddies: ['reading', 'writing'], badge: 'IELTS Paraphrase' };
    case 'match': {
      const lead = cycle[(index + 2) % cycle.length]!;
      return { lead, buddies: pickBuddies(lead), badge: 'Word Match' };
    }
    default: {
      const lead = cycle[index % cycle.length]!;
      return { lead, buddies: pickBuddies(lead), badge: 'IELTS Vocab' };
    }
  }
}

/**
 * A row of multiple colourful mascots used on celebration/milestone screens
 * and headers.
 */
export function MascotSquad({
  variants = ['brand', 'reading', 'listening', 'writing', 'speaking'],
  mood = 'happy',
  size = 56,
  look = 'center',
}: {
  variants?: readonly MascotVariant[];
  mood?: MascotMood;
  size?: number;
  look?: MascotLook;
}) {
  return (
    <div className="mascot-squad" aria-hidden="true">
      {variants.map((variant) => (
        <Mascot key={variant} variant={variant} mood={mood} look={look} size={size} />
      ))}
    </div>
  );
}

/**
 * The mascot's reaction to one answer.
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
