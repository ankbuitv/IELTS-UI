import type { ReactElement, SVGProps } from 'react';

/**
 * Icon set.
 *
 * A single, dependency-free stroke set drawn on a 24×24 grid, so navigation,
 * cards and tables share one visual language instead of mixing emoji, glyph
 * characters and text. Every icon inherits `currentColor` and scales with the
 * `size` prop; `aria-hidden` is set by default because icons in this product
 * always sit next to a text label (an `title` can opt a decorative icon into
 * the accessibility tree when it is the only label).
 */
export type IconName =
  | 'grid'
  | 'book'
  | 'clock'
  | 'users'
  | 'chart'
  | 'user'
  | 'presentation'
  | 'pen'
  | 'shield'
  | 'settings'
  | 'menu'
  | 'close'
  | 'logout'
  | 'chevronRight'
  | 'chevronDown'
  | 'check'
  | 'plus'
  | 'search'
  | 'sparkle'
  | 'headphones'
  | 'layers'
  | 'target'
  | 'zap'
  | 'globe'
  | 'arrowRight'
  | 'external'
  | 'flag'
  | 'info'
  | 'alert'
  | 'lock'
  | 'calendar'
  | 'mail'
  | 'trendingUp'
  | 'award'
  | 'file'
  | 'upload'
  | 'play'
  | 'list'
  | 'expand'
  | 'mic'
  | 'pause'
  | 'stop'
  | 'rotate'
  | 'trash'
  | 'download'
  | 'wand'
  | 'heart'
  | 'home'
  | 'flame'
  | 'star'
  | 'volume'
  | 'graduation'
  | 'bubble'
  | 'checkCircle'
  | 'bolt'
  | 'eye';

const PATHS: Record<IconName, ReactElement> = {
  grid: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2 2 0 0 1 6 3.5h5.5v16H6a2 2 0 0 0-2 2z" />
      <path d="M20 5.5a2 2 0 0 0-2-2h-5.5v16H18a2 2 0 0 1 2 2z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6" />
      <path d="M17.5 14.8c2 .7 3.2 2.5 3.2 5.2" />
    </>
  ),
  chart: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M6.5 20.5V13" />
      <path d="M11 20.5V6.5" />
      <path d="M15.5 20.5v-5" />
      <path d="M20 20.5V9.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c0-3.9 3.4-6.5 7.5-6.5s7.5 2.6 7.5 6.5" />
    </>
  ),
  presentation: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2.5" />
      <path d="M12 16v4" />
      <path d="M8 20h8" />
      <path d="M8 8.5h5" />
      <path d="M8 12h8" />
    </>
  ),
  pen: (
    <>
      <path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="M14.5 5.5 18.5 9.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2 19 6v5.4c0 4.4-2.9 7.6-7 9.4-4.1-1.8-7-5-7-9.4V6z" />
      <path d="M9.2 12.2 11.4 14.4 15.2 10.4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.2 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 4.5H18a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3.5" />
      <path d="M10 16 6 12l4-4" />
      <path d="M6 12h9" />
    </>
  ),
  chevronRight: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  chevronDown: <path d="M5.5 9.5 12 16l6.5-6.5" />,
  check: <path d="M5 12.8 9.6 17.5 19 7" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5c1 4 2.5 5.5 6.5 6.5-4 1-5.5 2.5-6.5 6.5-1-4-2.5-5.5-6.5-6.5 4-1 5.5-2.5 6.5-6.5Z" />
      <path d="M18.5 16.5c.5 2 1.2 2.7 3 3-1.8.4-2.5 1-3 3-.5-2-1.2-2.6-3-3 1.8-.3 2.5-1 3-3Z" />
    </>
  ),
  headphones: (
    <>
      <path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3" />
      <rect x="2.5" y="14" width="4.5" height="6.5" rx="2.2" />
      <rect x="17" y="14" width="4.5" height="6.5" rx="2.2" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5 3.5 8 12 12.5 20.5 8z" />
      <path d="M3.5 12.5 12 17l8.5-4.5" />
      <path d="M3.5 16.5 12 21l8.5-4.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  zap: <path d="M13.5 3 5.5 13.5H11l-1 7.5 8.5-11H13z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5Z" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4.5 12h14" />
      <path d="M13 6.5 18.5 12 13 17.5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4.5h5.5V10" />
      <path d="M19.5 4.5 11 13" />
      <path d="M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5" />
    </>
  ),
  flag: (
    <>
      <path d="M6 21V4" />
      <path d="M6 5h11.5l-2.2 4.2 2.2 4.3H6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.8h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 3 19.5h18z" />
      <path d="M12 10v4.2" />
      <path d="M12 17.2h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17" />
      <path d="M8 3.5v4" />
      <path d="M16 3.5v4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m4 7.5 8 5.5 8-5.5" />
    </>
  ),
  trendingUp: (
    <>
      <path d="m3.5 16.5 5-5 3.5 3.5 6.5-6.5" />
      <path d="M14.5 8.5h5.5V14" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="9.5" r="5.5" />
      <path d="m8.5 14.5-1.5 6 5-2.5 5 2.5-1.5-6" />
    </>
  ),
  file: (
    <>
      <path d="M6.5 3.5h7L19 9v11.5a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5V9H19" />
      <path d="M9 13h6" />
      <path d="M9 16.5h4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4.5" />
      <path d="m7.5 9 4.5-4.5L16.5 9" />
      <path d="M4.5 15v3.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V15" />
    </>
  ),
  play: <path d="M7.5 4.5 19 12 7.5 19.5z" />,
  pause: (
    <>
      <rect x="7" y="5" width="3.4" height="14" rx="1.2" />
      <rect x="13.6" y="5" width="3.4" height="14" rx="1.2" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.2" />,
  mic: (
    <>
      <rect x="9.2" y="3" width="5.6" height="10.5" rx="2.8" />
      <path d="M5.8 11.4a6.2 6.2 0 0 0 12.4 0M12 17.6V21M9 21h6" />
    </>
  ),
  rotate: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 4.4V9h-4.7" />
      <rect x="8.4" y="8.4" width="7.2" height="9.4" rx="1.6" />
    </>
  ),
  trash: (
    <>
      <path d="M4.8 6.8h14.4M9.6 6.8V4.9h4.8v1.9M7 6.8l.8 12.1a1.6 1.6 0 0 0 1.6 1.5h5.2a1.6 1.6 0 0 0 1.6-1.5l.8-12.1" />
    </>
  ),
  download: <path d="M12 4v10.4M7.6 10.6 12 15l4.4-4.4M5 19h14" />,
  wand: (
    <>
      <path d="M5 19 16.2 7.8M14.4 5.4l1.2-1.2M19.8 10.8l-1.2 1.2M18.6 5.4l1.2-1.2M4.2 10.8l1.2 1.2" />
      <path d="m15.2 4.2 4.6 4.6" />
    </>
  ),
  heart: <path d="M12 20.4s-7.6-4.5-7.6-10.1A4.3 4.3 0 0 1 12 7.5a4.3 4.3 0 0 1 7.6 2.8c0 5.6-7.6 10.1-7.6 10.1z" />,
  home: (
    <>
      <path d="M4 11.2 12 4l8 7.2V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.2H9v5.2H5.5A1.5 1.5 0 0 1 4 19z" />
    </>
  ),
  flame: (
    <path d="M12 2.8c.6 3.3 4.4 5.2 4.4 9.6a4.4 4.4 0 0 1-8.8 0c0-1.8.7-3 1.6-3.9.3 1.3 1 2 1.9 2.1C10.6 7.8 10.7 5.3 12 2.8z" />
  ),
  star: <path d="M12 3.4l2.7 5.5 6 .9-4.4 4.2 1 6L12 17.2 6.7 20l1-6L3.3 9.8l6-.9z" />,
  volume: (
    <>
      <path d="M4 9.6h3.3L12 5.6v12.8l-4.7-4H4z" />
      <path d="M15.6 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18.2 6.6a7.7 7.7 0 0 1 0 10.8" />
    </>
  ),
  graduation: (
    <>
      <path d="M2.6 9.6 12 5l9.4 4.6L12 14.2z" />
      <path d="M6.6 11.8v4c0 1.1 2.4 2.9 5.4 2.9s5.4-1.8 5.4-2.9v-4" />
      <path d="M21.4 9.6v5" />
    </>
  ),
  bubble: <path d="M5.5 4.5h13A2.5 2.5 0 0 1 21 7v8a2.5 2.5 0 0 1-2.5 2.5H12L7.5 21v-3.5h-2A2.5 2.5 0 0 1 3 15V7a2.5 2.5 0 0 1 2.5-2.5z" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.4 2.8 2.8 5.4-5.6" />
    </>
  ),
  bolt: <path d="M13.2 2.8 5.2 13.4h5.6l-1 7.8 8-10.6h-5.6z" />,
  eye: (
    <>
      <path d="M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  list: (
    <>
      <path d="M8.5 6.5h11" />
      <path d="M8.5 12h11" />
      <path d="M8.5 17.5h11" />
      <path d="M4.5 6.5h.01" />
      <path d="M4.5 12h.01" />
      <path d="M4.5 17.5h.01" />
    </>
  ),
  expand: (
    <>
      <path d="M14.5 4.5H19.5V9.5" />
      <path d="M19.5 4.5 14 10" />
      <path d="M9.5 19.5H4.5V14.5" />
      <path d="M4.5 19.5 10 14" />
    </>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number | string;
  strokeWidth?: number;
  /** Solid shape instead of an outline (streak flame, hearts, stars). */
  filled?: boolean;
  /** Provide only when the icon is the sole label for a control. */
  label?: string;
}

export function Icon({ name, size = 18, strokeWidth = 1.7, filled = false, label, className = '', ...rest }: IconProps) {
  const art = PATHS[name];
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {art}
    </svg>
  );
}
