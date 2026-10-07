/**
 * Original learning companions, drawn in SVG so every character stays crisp at
 * lesson and dashboard sizes. Each has its own palette and silhouette accent.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { sfx } from '../../lib/sfx';

export const MASCOT_MOODS = ['idle', 'happy', 'sad', 'wow', 'think', 'wave', 'sleep', 'fly'] as const;
export type MascotMood = (typeof MASCOT_MOODS)[number];
export type MascotTone = 'plain' | 'good' | 'bad' | 'info';
export const MASCOT_CHARACTERS = [
  'bo', 'luna', 'pip', 'kai', 'nori', 'mimi', 'komet', 'tiki', 'fuyu', 'moti', 'amber', 'daisy',
] as const;
export type MascotCharacter = (typeof MASCOT_CHARACTERS)[number];

const CHARACTERS: Record<MascotCharacter, { name: string; top: string; bottom: string; belly: string; accent: string; detail: string; accessory: string }> = {
  bo: { name: 'Bơ', top: '#5fd39a', bottom: '#1f9d63', belly: '#e6fff0', accent: '#328c5b', detail: '#f5a623', accessory: 'sprout' },
  luna: { name: 'Luna', top: '#c4a5ff', bottom: '#8054cf', belly: '#fff2fd', accent: '#6843ad', detail: '#f7d866', accessory: 'ears' },
  pip: { name: 'Pip', top: '#ffe074', bottom: '#eea92e', belly: '#fff9dc', accent: '#ce8121', detail: '#e97758', accessory: 'tufts' },
  kai: { name: 'Kai', top: '#61d5d0', bottom: '#188f94', belly: '#e0fffa', accent: '#147b7f', detail: '#f3aa39', accessory: 'shell' },
  nori: { name: 'Nori', top: '#a3b8ed', bottom: '#5268a8', belly: '#f2f4ff', accent: '#42578e', detail: '#f4c957', accessory: 'crown' },
  mimi: { name: 'Mimi', top: '#ffb7cc', bottom: '#e979a3', belly: '#fff0f6', accent: '#c85e88', detail: '#8f70d6', accessory: 'cloud' },
  komet: { name: 'Komet', top: '#ffa77d', bottom: '#e86c50', belly: '#fff2e8', accent: '#c74e40', detail: '#ffd45d', accessory: 'horns' },
  tiki: { name: 'Tiki', top: '#9dde79', bottom: '#5aa63e', belly: '#f2ffdc', accent: '#448733', detail: '#e76f95', accessory: 'eyes' },
  fuyu: { name: 'Fuyu', top: '#a8defb', bottom: '#559bc9', belly: '#f0fbff', accent: '#397ca7', detail: '#f4bb62', accessory: 'antenna' },
  moti: { name: 'Moti', top: '#77c7ef', bottom: '#407ec0', belly: '#e8f7ff', accent: '#37669e', detail: '#ffcd65', accessory: 'fins' },
  amber: { name: 'Amber', top: '#d8a678', bottom: '#9a6546', belly: '#fff0df', accent: '#7a4e38', detail: '#6cbc8a', accessory: 'ears' },
  daisy: { name: 'Daisy', top: '#f1a9e7', bottom: '#aa61c8', belly: '#fff0fe', accent: '#874da6', detail: '#f3df64', accessory: 'star' },
};

const TONE_CLASS: Record<MascotTone, string> = {
  plain: '',
  good: ' mascot__bubble--good',
  bad: ' mascot__bubble--bad',
  info: ' mascot__bubble--info',
};

function Eyes({ mood }: { mood: MascotMood }) {
  const stroke = { fill: 'none', stroke: '#1d2a38', strokeWidth: 2.4, strokeLinecap: 'round' as const };
  if (mood === 'happy' || mood === 'wow') {
    return <g><path d="M40 62 q8 -9 16 0" {...stroke} /><path d="M64 62 q8 -9 16 0" {...stroke} /></g>;
  }
  if (mood === 'sleep') {
    return <g><path d="M41 63 h14" {...stroke} /><path d="M65 63 h14" {...stroke} /></g>;
  }
  if (mood === 'sad') {
    return (
      <g>
        <circle cx="48" cy="63" r="8.6" fill="#fff" /><circle cx="72" cy="63" r="8.6" fill="#fff" />
        <circle cx="48" cy="66" r="4" fill="#2b3b4c" /><circle cx="72" cy="66" r="4" fill="#2b3b4c" />
        <path d="M39 54 q9 -4 17 -1" {...stroke} /><path d="M64 53 q9 -3 17 1" {...stroke} />
        <path className="mascot__tear" d="M78 70 q3 5 0 8 q-3 -3 0 -8" fill="#8fd0ff" />
      </g>
    );
  }
  const shift = mood === 'think' ? 2.4 : 0;
  return (
    <g>
      <circle cx="48" cy="62" r="9" fill="#fff" /><circle cx="72" cy="62" r="9" fill="#fff" />
      <circle className="mascot__pupil" cx={48 + shift} cy="62" r="4.4" fill="#2b3b4c" />
      <circle className="mascot__pupil" cx={72 + shift} cy="62" r="4.4" fill="#2b3b4c" />
      <circle cx={46.6 + shift} cy="60.2" r="1.4" fill="#fff" /><circle cx={70.6 + shift} cy="60.2" r="1.4" fill="#fff" />
    </g>
  );
}

function Mouth({ mood }: { mood: MascotMood }) {
  const stroke = { fill: 'none', stroke: '#1d2a38', strokeWidth: 2.4, strokeLinecap: 'round' as const };
  if (mood === 'wow') return <g><ellipse cx="60" cy="80" rx="7" ry="8.5" fill="#1d2a38" /><ellipse cx="60" cy="83" rx="4" ry="4" fill="#f06a7f" /></g>;
  if (mood === 'happy') return <g><path d="M48 76 q12 14 24 0" fill="#1d2a38" /><path d="M52 84 q8 6 16 0" fill="#f06a7f" opacity="0.85" /></g>;
  if (mood === 'sad') return <path d="M50 84 q10 -9 20 0" {...stroke} />;
  if (mood === 'sleep') return <path d="M54 80 q6 4 12 0" {...stroke} />;
  return <path d="M53 79 q7 6 14 0" {...stroke} />;
}

function Accessory({ type, accent, detail }: { type: string; accent: string; detail: string }) {
  switch (type) {
    case 'sprout':
      return <g><path d="M60 42 C60 31 60 23 60 16" fill="none" stroke={accent} strokeWidth="3.4" strokeLinecap="round" /><ellipse cx="50" cy="20" rx="9" ry="5.4" fill={detail} transform="rotate(-24 50 20)" /><ellipse cx="70" cy="18" rx="9" ry="5.4" fill={accent} transform="rotate(22 70 18)" /></g>;
    case 'ears':
      return <g><path d="M43 45 Q34 10 45 12 Q56 14 56 45" fill={accent} /><path d="M64 45 Q64 13 76 12 Q86 14 77 47" fill={accent} /><path d="M43 34 Q41 20 46 20 Q50 21 51 36" fill={detail} opacity=".72" /><path d="M68 36 Q69 21 75 20 Q79 21 76 35" fill={detail} opacity=".72" /></g>;
    case 'tufts':
      return <g><path d="M42 41 L37 22 L53 35 Z" fill={accent} /><path d="M63 35 L79 20 L76 43 Z" fill={accent} /><path d="M44 34 L41 28 L49 35 Z" fill={detail} /></g>;
    case 'shell':
      return <g><ellipse cx="60" cy="50" rx="23" ry="14" fill={accent} stroke="#fff" strokeOpacity=".65" strokeWidth="2" /><path d="M60 37 v25 M38 50 h44 M45 41 l30 19 M75 41 L45 59" fill="none" stroke={detail} strokeWidth="2" opacity=".8" /><circle cx="60" cy="50" r="4" fill={detail} /></g>;
    case 'crown':
      return <g><path d="M41 40 L38 20 L51 31 L60 14 L69 31 L83 20 L79 42 Z" fill={detail} stroke={accent} strokeWidth="2" strokeLinejoin="round" /><circle cx="60" cy="23" r="2.5" fill="#fff" /></g>;
    case 'cloud':
      return <g fill={detail}><circle cx="35" cy="48" r="9" /><circle cx="44" cy="39" r="11" /><circle cx="54" cy="47" r="10" /><circle cx="79" cy="44" r="8" opacity=".8" /></g>;
    case 'horns':
      return <g><path d="M43 43 Q30 34 36 18 Q48 25 51 40" fill={detail} stroke={accent} strokeWidth="2" /><path d="M68 40 Q72 25 85 19 Q89 35 77 44" fill={detail} stroke={accent} strokeWidth="2" /></g>;
    case 'eyes':
      return <g><circle cx="43" cy="43" r="12" fill={detail} /><circle cx="77" cy="43" r="12" fill={detail} /><circle cx="43" cy="43" r="5" fill="#fff" /><circle cx="77" cy="43" r="5" fill="#fff" /></g>;
    case 'antenna':
      return <g><path d="M49 43 Q42 22 34 21 M71 43 Q78 22 86 21" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" /><circle cx="33" cy="20" r="6" fill={detail} /><circle cx="87" cy="20" r="6" fill={detail} /></g>;
    case 'fins':
      return <g><path d="M26 64 Q9 47 16 37 Q35 40 39 56 Z" fill={detail} stroke={accent} strokeWidth="2" /><path d="M94 64 Q111 47 104 37 Q85 40 81 56 Z" fill={detail} stroke={accent} strokeWidth="2" /><path d="M48 35 Q60 21 72 35" fill="none" stroke={detail} strokeWidth="4" strokeLinecap="round" /></g>;
    case 'star':
      return <g><path d="M60 12 l5 12 13 1 -10 8 3 13 -11 -7 -11 7 3 -13 -10 -8 13 -1 z" fill={detail} stroke={accent} strokeWidth="1.5" /><circle cx="35" cy="40" r="3" fill={detail} /><circle cx="86" cy="42" r="2.5" fill={detail} /></g>;
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
  character = 'bo',
}: {
  mood?: MascotMood;
  size?: number;
  message?: string;
  tone?: MascotTone;
  className?: string;
  character?: MascotCharacter;
}) {
  const id = useId().replace(/:/g, '');
  const artId = useRef<HTMLButtonElement | null>(null);
  const [clicked, setClicked] = useState(false);
  const resetClick = useRef<number | null>(null);
  const palette = CHARACTERS[character] ?? CHARACTERS.bo;
  useEffect(() => () => { if (resetClick.current !== null) window.clearTimeout(resetClick.current); }, []);

  const tap = () => {
    setClicked(true);
    sfx.play('tap');
    if (resetClick.current !== null) window.clearTimeout(resetClick.current);
    resetClick.current = window.setTimeout(() => setClicked(false), 700);
    artId.current?.blur();
  };

  return (
    <span
      className={`mascot mascot--${mood}${clicked ? ' mascot--clicked' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--mascot-size': `${size}px` } as CSSProperties}
    >
      <button ref={artId} className="mascot__tap" type="button" onClick={tap} aria-label={`Tap ${palette.name}, the ${mood} learning companion`} title={`Say hello to ${palette.name}`}>
        <svg className="mascot__art" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.top} /><stop offset="100%" stopColor={palette.bottom} />
            </linearGradient>
            <linearGradient id={`${id}-belly`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff" /><stop offset="100%" stopColor={palette.belly} />
            </linearGradient>
          </defs>
          <ellipse className="mascot__shadow" cx="60" cy="110" rx="30" ry="6" fill="#1d2a38" opacity="0.1" />
          {palette.accessory === 'shell' ? <Accessory type="shell" accent={palette.accent} detail={palette.detail} /> : null}
          {palette.accessory === 'cloud' ? <Accessory type="cloud" accent={palette.accent} detail={palette.detail} /> : null}
          {palette.accessory === 'fins' ? <Accessory type="fins" accent={palette.accent} detail={palette.detail} /> : null}
          {palette.accessory === 'horns' || palette.accessory === 'ears' || palette.accessory === 'tufts' || palette.accessory === 'sprout' || palette.accessory === 'crown' || palette.accessory === 'star' || palette.accessory === 'antenna' || palette.accessory === 'eyes' ? (
            <g className="mascot__head-accessory"><Accessory type={palette.accessory} accent={palette.accent} detail={palette.detail} /></g>
          ) : null}
          <ellipse className="mascot__wing mascot__wing--left" cx="20" cy="72" rx="8.5" ry="14" fill={palette.accent} transform="rotate(-14 20 72)" />
          <ellipse className="mascot__wing mascot__wing--right" cx="100" cy="72" rx="8.5" ry="14" fill={palette.accent} transform="rotate(14 100 72)" />
          <g className="mascot__body">
            <ellipse cx="60" cy="70" rx="37" ry="35" fill={`url(#${id}-body)`} />
            <ellipse cx="60" cy="79" rx="24" ry="22" fill={`url(#${id}-belly)`} />
            <circle cx="38" cy="77" r="6" fill="#ff9fb0" opacity="0.5" /><circle cx="82" cy="77" r="6" fill="#ff9fb0" opacity="0.5" />
            <Eyes mood={mood} />
            <path d="M55.5 72.5 h9 l-4.5 5.5 z" fill={palette.detail} />
            <Mouth mood={mood} />
            {mood === 'think' ? <text className="mascot__mark" x="96" y="40" fontSize="20" fill="#5b6b80" fontWeight="700">?</text> : null}
            {mood === 'sleep' ? <text className="mascot__mark mascot__mark--zzz" x="94" y="42" fontSize="16" fill="#7b8aa0" fontWeight="700">z z</text> : null}
          </g>
          <g className="mascot__feet"><rect x="45" y="100" width="12" height="8" rx="4" fill={palette.detail} /><rect x="63" y="100" width="12" height="8" rx="4" fill={palette.detail} opacity=".88" /></g>
          {mood === 'wow' || mood === 'fly' ? (
            <g className="mascot__sparkles" fill={palette.detail}>
              <path d="M22 34 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" />
              <path d="M100 30 l2.4 5.6 l5.6 2.4 l-5.6 2.4 l-2.4 5.6 l-2.4 -5.6 l-5.6 -2.4 l5.6 -2.4 z" opacity="0.85" />
            </g>
          ) : null}
          {mood === 'happy' ? <g className="mascot__sparkles" fill={palette.detail}><path d="M18 40 l2.6 6 l6 2.6 l-6 2.6 l-2.6 6 l-2.6 -6 l-6 -2.6 l6 -2.6 z" /></g> : null}
        </svg>
      </button>
      {message ? <span className={`mascot__bubble${TONE_CLASS[tone]}`} role="status">{message}</span> : null}
    </span>
  );
}

export function mascotForQuestion(questionId: string): MascotCharacter {
  let hash = 0;
  for (const char of questionId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return MASCOT_CHARACTERS[hash % MASCOT_CHARACTERS.length] ?? 'bo';
}

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
