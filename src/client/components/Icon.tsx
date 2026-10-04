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
  | 'chevronUp'
  | 'chevronLeft'
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
  | 'arrowLeft'
  | 'arrowUp'
  | 'arrowDown'
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
  | 'eye'
  | 'coin'
  | 'trophy'
  | 'cart'
  | 'snowflake'
  | 'bulb'
  | 'crown'
  | 'shieldCheck'
  | 'hourglass'
  | 'medal'
  | 'camera'
  | 'image'
  | 'link'
  | 'exit'
  | 'palette'
  | 'heartCrack'
  | 'combo'
  | 'keyboard'
  | 'noEntry';

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
  // The other two directions: the reorder buttons in the test editor used to be
  // a bare "↑"/"↓" character, which inherits the surrounding font and sits off
  // centre in a square button. Drawn strokes line up with every other icon.
  chevronUp: <path d="M5.5 14.5 12 8l6.5 6.5" />,
  chevronLeft: <path d="M14.5 5.5 8 12l6.5 6.5" />,
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
  arrowLeft: (
    <>
      <path d="M19.5 12h-14" />
      <path d="M11 6.5 5.5 12 11 17.5" />
    </>
  ),
  arrowUp: (
    <>
      <path d="M12 19.5v-14" />
      <path d="M6.5 11 12 5.5 17.5 11" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M12 4.5v14" />
      <path d="M6.5 13 12 18.5 17.5 13" />
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
    <path d="M13.1 2.2C13.6 6 16 7.6 17.4 10c1 1.7 1.3 3.2 1.3 4.6 0 3.5-2.9 6.4-6.7 6.4S5.3 18.1 5.3 14.6c0-2.1.9-3.8 2.2-5.1.2 1.7 1 2.8 2.3 3.2-.5-4 .6-8 3.3-10.5z" />
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
  coin: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4v9.2" />
      <path d="M14.6 9.4c-.8-.7-4.3-1.1-4.3.9 0 1.9 4.3 1 4.3 2.9 0 2-3.5 1.6-4.3.9" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.5 4.6h9v4.2a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 6H5a2.2 2.2 0 0 0 2.4 3.4" />
      <path d="M16.5 6H19a2.2 2.2 0 0 1-2.4 3.4" />
      <path d="M12 13.3v3.6" />
      <path d="M8.6 20h6.8l-.7-3.1H9.3z" />
    </>
  ),
  cart: (
    <>
      <path d="M3.4 4.6h2.2l2.3 9.6h9.2" />
      <path d="M6.6 7.4h12.9l-1.6 5.4H7.9" />
      <circle cx="9.4" cy="18.6" r="1.5" />
      <circle cx="16.6" cy="18.6" r="1.5" />
    </>
  ),
  snowflake: (
    <>
      <path d="M12 3v18" />
      <path d="M4.2 7.5l15.6 9" />
      <path d="M19.8 7.5l-15.6 9" />
      <path d="M12 6.6l-2-2M12 6.6l2-2" />
      <path d="M12 17.4l-2 2M12 17.4l2 2" />
    </>
  ),
  bulb: (
    <>
      <path d="M9.2 17.4h5.6" />
      <path d="M10 20.4h4" />
      <path d="M12 3.6a5.6 5.6 0 0 1 3.4 10.1c-.6.5-.9 1.1-.9 1.8v1H9.5v-1c0-.7-.3-1.3-.9-1.8A5.6 5.6 0 0 1 12 3.6z" />
    </>
  ),
  crown: (
    <>
      <path d="M4 17.6l-1-9.2 5.2 3.4L12 5.4l3.8 6.4 5.2-3.4-1 9.2z" />
      <path d="M4.6 20.6h14.8" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M12 3.4l7 2.7v5.4c0 4.2-2.9 7.6-7 9.1-4.1-1.5-7-4.9-7-9.1V6.1z" />
      <path d="M8.8 12.1l2.2 2.2 4.2-4.4" />
    </>
  ),
  hourglass: (
    <>
      <path d="M8 3.6h8" />
      <path d="M8 20.4h8" />
      <path d="M8.6 3.6c0 3.2 3.4 4.9 3.4 8.4s-3.4 5.2-3.4 8.4" />
      <path d="M15.4 3.6c0 3.2-3.4 4.9-3.4 8.4s3.4 5.2 3.4 8.4" />
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
  medal: (
    <>
      <path d="M8.4 3.2 12 9.4l3.6-6.2" />
      <path d="M5.6 3.2 9 9" />
      <path d="M18.4 3.2 15 9" />
      <circle cx="12" cy="15.2" r="5.6" />
      <path d="m12 12.4.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" />
    </>
  ),
  camera: (
    <>
      <path d="M3.5 8.6h3.2l1.5-2.4h7.6l1.5 2.4h3.2v10.2H3.5z" />
      <circle cx="12" cy="13.4" r="3.5" />
    </>
  ),
  image: (
    <>
      <rect x="3.2" y="4.8" width="17.6" height="14.4" rx="2.6" />
      <circle cx="8.6" cy="10" r="1.7" />
      <path d="m4.2 17.4 4.9-4.6 3.4 3.1 3-2.6 4.3 4.1" />
    </>
  ),
  link: (
    <>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.3.3l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.5 1.5" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.3-.3l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.5-1.5" />
    </>
  ),
  exit: (
    <>
      <path d="M14 4.6h4.2a1.8 1.8 0 0 1 1.8 1.8v11.2a1.8 1.8 0 0 1-1.8 1.8H14" />
      <path d="M9.6 15.8 5.8 12l3.8-3.8" />
      <path d="M5.8 12h9.4" />
      <path d="M4 4.6v14.8" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.3 0 2-.9 2-1.9 0-1.4-1.1-1.7-1.1-2.8 0-.8.7-1.5 1.6-1.5h1.6a4.5 4.5 0 0 0 4.5-4.5c0-3.6-3.7-6.5-8.6-6.5Z" />
      <circle cx="7.6" cy="11.4" r="1.1" />
      <circle cx="10.6" cy="7.6" r="1.1" />
      <circle cx="15.2" cy="8.2" r="1.1" />
    </>
  ),
  heartCrack: (
    <>
      <path d="M12 20.4s-7.6-4.5-7.6-10.1A4.3 4.3 0 0 1 12 7.5a4.3 4.3 0 0 1 7.6 2.8c0 5.6-7.6 10.1-7.6 10.1z" />
      <path d="M12.6 7.6 10 11.4l3 1.3-2.2 4" />
    </>
  ),
  combo: (
    <>
      <path d="M12 3.2c2.2 3.1 1.1 5 3.5 6.7 1.6 1.1 2.3 2.5 2.3 4.1a5.8 5.8 0 1 1-11.6 0c0-2.4 1.3-4 2.6-5.3.2 1.5.9 2.4 1.9 2.7-.6-3.6.2-6.3 1.3-8.2Z" />
      <path d="M12 20.2a2.6 2.6 0 0 0 2.6-2.6c0-1.6-1.5-2.2-2.6-4-1.1 1.8-2.6 2.4-2.6 4a2.6 2.6 0 0 0 2.6 2.6Z" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.6" y="6.4" width="18.8" height="11.2" rx="2.4" />
      <path d="M6.4 10h.01M9.6 10h.01M12.8 10h.01M16 10h.01M6.4 13h.01M17.6 13h.01M9.4 14.4h5.2" />
    </>
  ),
  noEntry: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m6.2 6.2 11.6 11.6" />
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

/**
 * A rank medal, drawn rather than typed.
 *
 * The boards used to show 🥇🥈🥉, which is an emoji: on a device without a
 * colour emoji font it renders as an empty box or a question mark, and it never
 * matches the stroke weight of the icons beside it. This draws the same three
 * metals on the 24×24 grid, so a podium reads identically everywhere.
 */
const MEDAL_TONES: Record<1 | 2 | 3, { rim: string; face: string; ribbon: string }> = {
  1: { rim: '#c98a00', face: '#ffd25e', ribbon: '#e23a41' },
  2: { rim: '#8d99a8', face: '#d7dee7', ribbon: '#3f7bff' },
  3: { rim: '#9a5b2c', face: '#dda371', ribbon: '#12805a' },
};

export function Medal({ rank, size = 20 }: { rank: number; size?: number }) {
  const tone = MEDAL_TONES[rank as 1 | 2 | 3];
  if (!tone) return null;
  return (
    <svg className="icon medal" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7.6 2.6h3.1L12 8.4 8.9 2.6z" fill={tone.ribbon} />
      <path d="M16.4 2.6h-3.1L12 8.4l3.1-5.8z" fill={tone.ribbon} opacity="0.72" />
      <circle cx="12" cy="14.6" r="6.4" fill={tone.rim} />
      <circle cx="12" cy="14.6" r="5.1" fill={tone.face} />
      <path
        d="m12 11.5.95 2 2.2.28-1.62 1.5.42 2.17L12 16.4l-1.95 1.05.42-2.17-1.62-1.5 2.2-.28z"
        fill={tone.rim}
      />
    </svg>
  );
}
