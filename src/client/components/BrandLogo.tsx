/**
 * Ai eo — original brand artwork, drawn as plain SVG paths so the header, the
 * footer and every share image look the same on every device (nothing in the
 * logo depends on a font being installed).
 *
 * The identity in one sentence: "the i in IELTS, talking". A speech bubble
 * holds three rising bars (a score going up) and the last bar is an "i" with a
 * golden dot. The wordmark is built from the same two shapes as the symbol,
 * round rings and rounded bars, so mark and name read as one thing.
 *
 * It is deliberately its own thing: no exam name appears in it and nothing
 * imitates a registered logo.
 *
 * Palette: IELTS-style red, deep navy ink and one golden accent.
 */

/**
 * light  on white or light grey
 * dark   on navy or any dark surface
 * brand  on a solid red surface (the bubble turns white)
 * auto   follows the --logo-* CSS variables, so one header works in light and dark mode
 */
export type BrandTheme = 'light' | 'dark' | 'brand' | 'auto';

interface Palette {
  /** The bubble / tile. */
  tile: string;
  /** The three bars drawn on the tile. */
  bars: string;
  /** The wordmark. */
  ink: string;
  /** The dot of the "i" (symbol and wordmark). */
  dot: string;
}

const PALETTES: Record<BrandTheme, Palette> = {
  /** On white or light grey. */
  light: { tile: '#D3222B', bars: '#FFFFFF', ink: '#14233A', dot: '#FFC53D' },
  /** On navy or any dark surface. */
  dark: { tile: '#E5343C', bars: '#FFFFFF', ink: '#FFFFFF', dot: '#FFC53D' },
  /** On a solid red surface: the bubble turns white. */
  brand: { tile: '#FFFFFF', bars: '#D3222B', ink: '#FFFFFF', dot: '#FFC53D' },
  /** Colours come from CSS custom properties (see globals.css and the dark theme). */
  auto: { tile: 'var(--logo-tile)', bars: 'var(--logo-bars)', ink: 'var(--logo-ink)', dot: 'var(--logo-dot)' },
};

/** A palette entry is either a literal colour or a CSS variable; variables go through `style`. */
const isVar = (value: string) => value.startsWith('var(');
const fillOf = (value: string) => (isVar(value) ? { style: { fill: value } } : { fill: value });
const strokeOf = (value: string) => (isVar(value) ? { style: { stroke: value } } : { stroke: value });

/** Speech bubble with a tail at the bottom left, in the 64 x 64 symbol grid. */
const BUBBLE = 'M18 3H46A14 14 0 0 1 60 17V35A14 14 0 0 1 46 49H31L18 60V49A14 14 0 0 1 4 35V17A14 14 0 0 1 18 3Z';

function SymbolArt({ palette }: { palette: Palette }) {
  return (
    <>
      <path d={BUBBLE} {...fillOf(palette.tile)} />
      <rect x="13" y="32" width="8" height="12" rx="4" {...fillOf(palette.bars)} />
      <rect x="28" y="25" width="8" height="19" rx="4" {...fillOf(palette.bars)} />
      <rect x="43" y="18" width="8" height="26" rx="4" {...fillOf(palette.bars)} />
      <circle cx="47" cy="11.4" r="4.3" {...fillOf(palette.dot)} />
    </>
  );
}

/**
 * The lowercase wordmark "ai eo", in its own units: the x-height is 30, the
 * baseline sits at y = 15 and the stroke is 8. Each letter is a ring or a
 * rounded bar, so the whole word is a handful of paths.
 */
function WordmarkArt({ palette }: { palette: Palette }) {
  return (
    <>
      <g fill="none" {...strokeOf(palette.ink)} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 0a11 11 0 1 0 22 0a11 11 0 1 0 -22 0" />
        <path d="M26 -11V11" />
        <path d="M38.5 -11V11" />
        <path d="M77.57 8.43A11 11 0 1 1 81.44 -1.15" />
        <path d="M94 0a11 11 0 1 0 22 0a11 11 0 1 0 -22 0" />
        <path d="M59.5 0H82.5" strokeWidth="5.4" strokeLinecap="butt" />
      </g>
      <circle cx="38.5" cy="-25.5" r="5" {...fillOf(palette.dot)} />
    </>
  );
}

/** The speech-bubble symbol on its own (loading states, empty states, avatars). */
export function BrandMark({
  theme = 'light',
  size = 32,
  title = 'Ai eo',
}: {
  theme?: BrandTheme;
  size?: number;
  title?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title} focusable="false">
      <title>{title}</title>
      <SymbolArt palette={PALETTES[theme]} />
    </svg>
  );
}

/**
 * App icon: a rounded red tile with the three bars and the dot, and no bubble
 * tail, so it stays readable down to 16px (favicon, home-screen icon).
 */
export function BrandIcon({
  theme = 'light',
  size = 32,
  title = 'Ai eo',
}: {
  theme?: BrandTheme;
  size?: number;
  title?: string;
}) {
  const palette = PALETTES[theme];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title} focusable="false">
      <title>{title}</title>
      <rect width="64" height="64" rx="14" {...fillOf(palette.tile)} />
      <rect x="12" y="37" width="9" height="12" rx="4.5" {...fillOf(palette.bars)} />
      <rect x="27.5" y="29" width="9" height="20" rx="4.5" {...fillOf(palette.bars)} />
      <rect x="43" y="21" width="9" height="28" rx="4.5" {...fillOf(palette.bars)} />
      <circle cx="47.5" cy="12.6" r="4.6" {...fillOf(palette.dot)} />
    </svg>
  );
}

/** Horizontal lockup: symbol + the "ai eo" wordmark. */
export function BrandLogo({
  theme = 'light',
  height = 36,
  title = 'Ai eo',
}: {
  theme?: BrandTheme;
  height?: number;
  title?: string;
}) {
  const palette = PALETTES[theme];
  const width = Math.round((height * 184) / 64);
  return (
    <svg width={width} height={height} viewBox="0 0 184 64" role="img" aria-label={title} focusable="false">
      <title>{title}</title>
      <SymbolArt palette={palette} />
      <g transform="translate(77 31) scale(0.8667)">
        <WordmarkArt palette={palette} />
      </g>
    </svg>
  );
}
