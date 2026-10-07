/**
 * Original Learn creatures, drawn locally in SVG. They are small companions,
 * not stock characters: Bơ the sprout-bird, Mực the jellyfish, and Sen the
 * lotus sprite. A question gets one creature, never a crowd.
 */
import { useId, useState, type CSSProperties } from 'react';

export const MASCOT_MOODS = ['idle', 'happy', 'sad', 'wow', 'think', 'wave', 'sleep'] as const;
export type MascotMood = (typeof MASCOT_MOODS)[number];
export const MASCOT_CREATURES = ['bo', 'muc', 'sen'] as const;
export type MascotCreature = (typeof MASCOT_CREATURES)[number];
export type MascotTone = 'plain' | 'good' | 'bad' | 'info';

const CREATURE_NAMES: Record<MascotCreature, string> = { bo: 'Bơ', muc: 'Mực', sen: 'Sen' };
const TONE_CLASS: Record<MascotTone, string> = {
  plain: '',
  good: ' mascot__bubble--good',
  bad: ' mascot__bubble--bad',
  info: ' mascot__bubble--info',
};

/** Pick a stable companion from the question id, so retries keep their creature. */
export function mascotForQuestion(questionId: string): MascotCreature {
  let hash = 0;
  for (const character of questionId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return MASCOT_CREATURES[Math.abs(hash) % MASCOT_CREATURES.length] ?? 'bo';
}

function GradientDefs({ uid, body, belly }: { uid: string; body: [string, string]; belly: [string, string] }) {
  return (
    <defs>
      <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={body[0]} />
        <stop offset="100%" stopColor={body[1]} />
      </linearGradient>
      <linearGradient id={`${uid}-belly`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={belly[0]} />
        <stop offset="100%" stopColor={belly[1]} />
      </linearGradient>
    </defs>
  );
}

/** Eyes are drawn as paths and shapes so every expression holds at small sizes. */
function Eyes({ mood }: { mood: MascotMood }) {
  const stroke = { fill: 'none', stroke: '#1d2a38', strokeWidth: 2.4, strokeLinecap: 'round' as const };
  if (mood === 'happy' || mood === 'wow') {
    return (
      <g className="mascot__eyes">
        <path d="M40 62 q8 -9 16 0" {...stroke} />
        <path d="M64 62 q8 -9 16 0" {...stroke} />
      </g>
    );
  }
  if (mood === 'sleep') {
    return (
      <g className="mascot__eyes">
        <path d="M41 63 h14" {...stroke} />
        <path d="M65 63 h14" {...stroke} />
      </g>
    );
  }
  if (mood === 'sad') {
    return (
      <g className="mascot__eyes">
        <circle cx="48" cy="63" r="8.6" fill="#ffffff" />
        <circle cx="72" cy="63" r="8.6" fill="#ffffff" />
        <circle cx="48" cy="66" r="4" fill="#2b3b4c" />
        <circle cx="72" cy="66" r="4" fill="#2b3b4c" />
        <path d="M39 54 q9 -4 17 -1" {...stroke} />
        <path d="M64 53 q9 -3 17 1" {...stroke} />
        <path className="mascot__tear" d="M78 70 q3 5 0 8 q-3 -3 0 -8" fill="#8fd0ff" />
      </g>
    );
  }
  const shift = mood === 'think' ? 2.4 : 0;
  return (
    <g className="mascot__eyes">
      <circle cx="48" cy="62" r="9" fill="#ffffff" />
      <circle cx="72" cy="62" r="9" fill="#ffffff" />
      <g className="mascot__pupils">
        <circle cx={48 + shift} cy="62" r="4.4" fill="#2b3b4c" />
        <circle cx={72 + shift} cy="62" r="4.4" fill="#2b3b4c" />
        <circle cx={46.6 + shift} cy="60.2" r="1.4" fill="#ffffff" />
        <circle cx={70.6 + shift} cy="60.2" r="1.4" fill="#ffffff" />
      </g>
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
  if (mood === 'sad') return <path d="M50 84 q10 -9 20 0" {...stroke} />;
  if (mood === 'sleep') return <path d="M54 80 q6 4 12 0" {...stroke} />;
  return <path d="M53 79 q7 6 14 0" {...stroke} />;
}

function Face({ mood }: { mood: MascotMood }) {
  return (
    <>
      <Eyes mood={mood} />
      <path d="M55.5 72.5 h9 l-4.5 5.5 z" fill="#f5a623" />
      <Mouth mood={mood} />
      {mood === 'think' ? <text className="mascot__mark" x="96" y="40" fontSize="20" fill="#5b6b80" fontWeight="700">?</text> : null}
      {mood === 'sleep' ? <text className="mascot__mark mascot__mark--zzz" x="94" y="42" fontSize="16" fill="#7b8aa0" fontWeight="700">z z</text> : null}
    </>
  );
}

function Sparkles({ mood }: { mood: MascotMood }) {
  if (mood !== 'wow' && mood !== 'happy') return null;
  return (
    <g className="mascot__sparkles" fill="#ffd75e">
      <path d="M22 34 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" />
      <path d="M100 30 l2.4 5.6 l5.6 2.4 l-5.6 2.4 l-2.4 5.6 l-2.4 -5.6 l-5.6 -2.4 l5.6 -2.4 z" opacity="0.85" />
    </g>
  );
}

function BoArt({ uid, mood }: { uid: string; mood: MascotMood }) {
  return (
    <>
      <GradientDefs uid={uid} body={['#5fd39a', '#1f9d63']} belly={['#f2fff8', '#d6f5e4']} />
      <ellipse className="mascot__shadow" cx="60" cy="110" rx="30" ry="6" fill="#1d2a38" opacity="0.1" />
      <g className="mascot__sprout">
        <path d="M60 40 C60 30 60 24 60 18" fill="none" stroke="#2f9e5f" strokeWidth="3.4" strokeLinecap="round" />
        <ellipse cx="50" cy="21" rx="9" ry="5.4" fill="#4cc483" transform="rotate(-24 50 21)" />
        <ellipse cx="70" cy="19" rx="9" ry="5.4" fill="#3bb377" transform="rotate(22 70 19)" />
      </g>
      <ellipse className="mascot__wing mascot__wing--left" cx="20" cy="72" rx="8.5" ry="14" fill="#1f8f5b" transform="rotate(-14 20 72)" />
      <ellipse className="mascot__wing mascot__wing--right" cx="100" cy="72" rx="8.5" ry="14" fill="#1a8253" transform="rotate(14 100 72)" />
      <g className="mascot__body">
        <ellipse cx="60" cy="70" rx="37" ry="35" fill={`url(#${uid}-body)`} />
        <ellipse cx="60" cy="79" rx="24" ry="22" fill={`url(#${uid}-belly)`} />
        <circle cx="38" cy="77" r="6" fill="#ff9fb0" opacity="0.5" />
        <circle cx="82" cy="77" r="6" fill="#ff9fb0" opacity="0.5" />
        <Face mood={mood} />
      </g>
      <g className="mascot__feet">
        <rect x="45" y="100" width="12" height="8" rx="4" fill="#f5a623" />
        <rect x="63" y="100" width="12" height="8" rx="4" fill="#e3941a" />
      </g>
      <Sparkles mood={mood} />
    </>
  );
}

/** Mực is a tiny violet jellyfish with soft tentacles and floating bubbles. */
function MucArt({ uid, mood }: { uid: string; mood: MascotMood }) {
  return (
    <>
      <GradientDefs uid={uid} body={['#c9a7ff', '#8055c9']} belly={['#fffaff', '#eadfff']} />
      <ellipse className="mascot__shadow" cx="60" cy="110" rx="29" ry="5" fill="#1d2a38" opacity="0.1" />
      <g className="mascot__tentacles" fill="none" stroke="#8055c9" strokeWidth="7" strokeLinecap="round">
        <path d="M39 81 q-5 9 0 17" />
        <path d="M51 85 q-4 10 2 16" />
        <path d="M68 85 q5 10 -1 16" />
        <path d="M81 81 q6 9 0 17" />
      </g>
      <g className="mascot__body">
        <path d="M27 73 C27 39 42 27 60 27 C79 27 94 41 93 73 Q91 84 81 78 Q72 87 63 79 Q52 87 43 78 Q33 85 27 73Z" fill={`url(#${uid}-body)`} />
        <ellipse cx="60" cy="77" rx="23" ry="17" fill={`url(#${uid}-belly)`} />
        <circle cx="38" cy="76" r="5" fill="#ff9fb0" opacity="0.55" />
        <circle cx="82" cy="76" r="5" fill="#ff9fb0" opacity="0.55" />
        <Face mood={mood} />
      </g>
      <g className="mascot__bubbles" fill="#b7e4ff">
        <circle cx="24" cy="46" r="3" />
        <circle cx="99" cy="56" r="4" />
        <circle cx="94" cy="28" r="2.5" />
      </g>
      <Sparkles mood={mood} />
    </>
  );
}

/** Sen is a warm lotus sprite with petal ears, a leaf collar and tiny shoes. */
function SenArt({ uid, mood }: { uid: string; mood: MascotMood }) {
  return (
    <>
      <GradientDefs uid={uid} body={['#ffb4a8', '#e66f83']} belly={['#fffaf0', '#ffe6d5']} />
      <ellipse className="mascot__shadow" cx="60" cy="110" rx="30" ry="5.5" fill="#1d2a38" opacity="0.1" />
      <g className="mascot__petals">
        <path d="M43 42 C28 28 38 13 52 28 L60 43Z" fill="#ffd2c4" stroke="#e98291" strokeWidth="1.5" />
        <path d="M60 42 C53 22 67 12 70 30 L68 44Z" fill="#fff0d9" stroke="#e98291" strokeWidth="1.5" />
        <path d="M72 43 C83 24 98 32 81 47Z" fill="#ffcfbf" stroke="#e98291" strokeWidth="1.5" />
      </g>
      <g className="mascot__leaves" fill="#64bd8e">
        <path d="M33 83 Q16 76 23 62 Q39 65 42 78Z" />
        <path d="M87 83 Q104 76 97 62 Q81 65 78 78Z" />
      </g>
      <g className="mascot__body">
        <ellipse cx="60" cy="70" rx="34" ry="36" fill={`url(#${uid}-body)`} />
        <ellipse cx="60" cy="80" rx="22" ry="20" fill={`url(#${uid}-belly)`} />
        <circle cx="40" cy="78" r="5" fill="#ff8e9e" opacity="0.48" />
        <circle cx="80" cy="78" r="5" fill="#ff8e9e" opacity="0.48" />
        <Face mood={mood} />
      </g>
      <g className="mascot__feet">
        <ellipse cx="48" cy="104" rx="7" ry="4" fill="#5a9f77" />
        <ellipse cx="72" cy="104" rx="7" ry="4" fill="#4c916b" />
      </g>
      <Sparkles mood={mood} />
    </>
  );
}

export function Mascot({
  mood = 'idle',
  size = 120,
  message,
  tone = 'plain',
  className = '',
  creature = 'bo',
  onClick,
}: {
  mood?: MascotMood;
  size?: number;
  /** A line the mascot says; drawn in a speech bubble beside it. */
  message?: string;
  tone?: MascotTone;
  className?: string;
  creature?: MascotCreature;
  onClick?: () => void;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [tapBurst, setTapBurst] = useState(0);
  const name = CREATURE_NAMES[creature];
  const tap = () => {
    setTapBurst((value) => value + 1);
    onClick?.();
  };
  return (
    <span
      className={`mascot mascot--${mood} mascot--${creature}${className ? ` ${className}` : ''}`}
      style={{ '--mascot-size': `${size}px` } as CSSProperties}
    >
      <button className="mascot__tap" type="button" onClick={tap} aria-label={`Give ${name} a gentle tap`} title={`Tap ${name}`}>
        {tapBurst > 0 ? <span key={`tap-${tapBurst}`} className="mascot__tap-spark" aria-hidden="true" /> : null}
        <svg key={tapBurst} className={`mascot__art${tapBurst > 0 ? ' mascot__art--boop' : ''}`} viewBox="0 0 120 120" aria-hidden="true">
          {creature === 'muc' ? <MucArt uid={id} mood={mood} /> : creature === 'sen' ? <SenArt uid={id} mood={mood} /> : <BoArt uid={id} mood={mood} />}
        </svg>
      </button>
      {message ? (
        <span className={`mascot__bubble${TONE_CLASS[tone]}`} role="status">
          {message}
        </span>
      ) : null}
    </span>
  );
}

/** The mascot's reaction to one answer, shared by lessons and review. */
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
