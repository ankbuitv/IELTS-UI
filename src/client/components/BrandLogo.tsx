/**
 * Ai eo — original brand artwork, rendered inline so the header and footers
 * never depend on a separate asset fetch.
 *
 * The mark is a crimson answer-sheet tile with a tick sitting on the answer
 * line (marked work), beside a bold two-tone "Ai eo" wordmark. It is drawn
 * from scratch for this project and deliberately avoids official exam
 * branding: no exam name appears in it, and nothing imitates a registered
 * logo. Palette: crimson on white, or a brighter crimson on the near-black bar.
 */

export type BrandTheme = 'light' | 'dark';

const FONT_STACK = `Arial,'Helvetica Neue',Helvetica,'Liberation Sans',sans-serif`;

interface Palette {
  tile: string;
  mark: string;
  wordA: string;
  wordB: string;
}

const PALETTES: Record<BrandTheme, Palette> = {
  light: { tile: '#C8102E', mark: '#FFFFFF', wordA: '#14171B', wordB: '#C8102E' },
  dark: { tile: '#E0243F', mark: '#FFFFFF', wordA: '#FFFFFF', wordB: '#FF6B7D' },
};

function IconArt({ palette }: { palette: Palette }) {
  return (
    <>
      <rect x="4" y="4" width="56" height="56" rx="5" fill={palette.tile} />
      <path d="M17 31l9.5 9.5L47 18" fill="none" stroke={palette.mark} strokeWidth="7" strokeLinejoin="miter" />
      <rect x="17" y="48" width="30" height="4" fill={palette.mark} />
    </>
  );
}

/** Compact icon / avatar. Stays readable down to ~16px. */
export function BrandIcon({
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
      <IconArt palette={PALETTES[theme]} />
    </svg>
  );
}

/**
 * Horizontal lockup: icon + bold two-tone "Ai eo" wordmark. `textLength` keeps
 * the lockup width deterministic across platforms and fonts.
 */
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
      <IconArt palette={palette} />
      <text
        x="72"
        y="43"
        fontFamily={FONT_STACK}
        fontSize="34"
        fontWeight={700}
        letterSpacing="-0.5"
        textLength={104}
        lengthAdjust="spacingAndGlyphs"
      >
        <tspan fill={palette.wordA}>Ai </tspan>
        <tspan fill={palette.wordB}>eo</tspan>
      </text>
    </svg>
  );
}
