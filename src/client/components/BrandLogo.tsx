/**
 * Ai eo — original brand artwork, drawn as plain SVG shapes so the header, the
 * footer and every share image look the same on every device (nothing in the
 * logo depends on a font being installed).
 *
 * The mark: three rounded bars, the shortest one an "i" with its dot above. It
 * is a single colour and carries no tile, so the same paths work on white, on
 * navy and on the brand red — only the colour changes, never the geometry.
 *
 * It is deliberately its own thing: no exam name appears in it and nothing
 * imitates a registered logo.
 *
 * Palette: brand red #E1251B, deep navy ink, and one brighter red for dark
 * surfaces where #E1251B would sit too heavy.
 */

/**
 * light  on white or light grey
 * dark   on navy or any dark surface
 * brand  on a solid red surface (the mark turns white)
 * auto   follows the --logo-* CSS variables, so one header works in light and dark mode
 */
export type BrandTheme = 'light' | 'dark' | 'brand' | 'auto';

interface Palette {
  /** The tile behind the mark, used by `BrandIcon` only. */
  tile: string;
  /** The three bars. */
  bars: string;
  /** The wordmark. */
  ink: string;
  /** The dot of the "i" — the same colour as the bars, the mark is monochrome. */
  dot: string;
}

const PALETTES: Record<BrandTheme, Palette> = {
  /** On white or light grey. */
  light: { tile: '#FFFFFF', bars: '#E1251B', ink: '#14233A', dot: '#E1251B' },
  /** On navy or any dark surface. */
  dark: { tile: '#0F172A', bars: '#FF4D4D', ink: '#FFFFFF', dot: '#FF4D4D' },
  /** On a solid red surface: the mark turns white. */
  brand: { tile: '#FFFFFF', bars: '#FFFFFF', ink: '#FFFFFF', dot: '#FFFFFF' },
  /** Colours come from CSS custom properties (see globals.css and the dark theme). */
  auto: { tile: 'var(--logo-tile)', bars: 'var(--logo-bars)', ink: 'var(--logo-ink)', dot: 'var(--logo-dot)' },
};

/** A palette entry is either a literal colour or a CSS variable; variables go through `style`. */
const isVar = (value: string) => value.startsWith('var(');
const fillOf = (value: string) => (isVar(value) ? { style: { fill: value } } : { fill: value });
const strokeOf = (value: string) => (isVar(value) ? { style: { stroke: value } } : { stroke: value });

/**
 * The mark, in the 64 x 64 grid: a short bar with its dot above (the "i"), then
 * the tallest bar, then a middle one. Identical to `public/favicon.svg` — keep
 * the two in step, they are the same artwork.
 */
function SymbolArt({ palette }: { palette: Palette }) {
  return (
    <>
      <rect x="12" y="32" width="9" height="20" rx="4.5" {...fillOf(palette.bars)} />
      <circle cx="16.5" cy="21" r="4.5" {...fillOf(palette.dot)} />
      <rect x="27.5" y="12" width="9" height="40" rx="4.5" {...fillOf(palette.bars)} />
      <rect x="43" y="22" width="9" height="30" rx="4.5" {...fillOf(palette.bars)} />
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

/** The mark on its own, with no tile (loading states, empty states, avatars). */
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
 * App icon: the mark on a rounded tile, so it keeps its shape as a home-screen
 * icon or a favicon where a transparent background would disappear.
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
      <rect width="64" height="64" rx="16" {...fillOf(palette.tile)} />
      <SymbolArt palette={palette} />
    </svg>
  );
}

/** Horizontal lockup: the mark + the "ai eo" wordmark. */
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
