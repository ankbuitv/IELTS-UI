import { useId } from 'react';

/**
 * Ai eo — original brand artwork, rendered inline so the navbar, sidebar and
 * footers never depend on a separate asset fetch.
 *
 * The mark is a rounded speech bubble (conversation / speaking practice) with
 * a check (marked work) and a small AI sparkle. It is deliberately distinct
 * from any official exam branding: no red roundel, no serif wordmark, no
 * imitation layout. Palette: white + cyan with violet/lime accents.
 */

export type BrandTheme = 'light' | 'dark';

const FONT_STACK =
  `'Baloo 2','Nunito','Quicksand','Segoe UI Rounded','SF Pro Rounded',` +
  `'Hiragino Maru Gothic ProN',ui-rounded,'Segoe UI',system-ui,sans-serif`;

interface Palette {
  bubbleFrom: string;
  bubbleTo: string;
  tailMain: string;
  tailSmall: string;
  sparkle: string;
  lime: string;
  wordA: string;
  wordB: string;
}

const PALETTES: Record<BrandTheme, Palette> = {
  light: {
    bubbleFrom: '#22d3ee',
    bubbleTo: '#0891b2',
    tailMain: '#0891b2',
    tailSmall: '#22d3ee',
    sparkle: '#8b5cf6',
    lime: '#84cc16',
    wordA: '#0f172a',
    wordB: '#0891b2',
  },
  dark: {
    bubbleFrom: '#67e8f9',
    bubbleTo: '#06b6d4',
    tailMain: '#22d3ee',
    tailSmall: '#67e8f9',
    sparkle: '#a78bfa',
    lime: '#a3e635',
    wordA: '#ffffff',
    wordB: '#67e8f9',
  },
};

function IconArt({ gradientId, palette }: { gradientId: string; palette: Palette }) {
  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={palette.bubbleFrom} />
          <stop offset="1" stopColor={palette.bubbleTo} />
        </linearGradient>
      </defs>
      <rect x="7" y="9" width="42" height="34" rx="12.5" fill={`url(#${gradientId})`} />
      <path
        d="M19.5 26.5l6.2 6.2L35.5 22"
        fill="none"
        stroke="#ffffff"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16.5" cy="48" r="4.6" fill={palette.tailMain} />
      <circle cx="8.5" cy="55.5" r="2.7" fill={palette.tailSmall} />
      <path
        d="M53 5c.9 3.6 2.4 5.1 6 6-3.6.9-5.1 2.4-6 6-.9-3.6-2.4-5.1-6-6 3.6-.9 5.1-2.4 6-6Z"
        fill={palette.sparkle}
      />
      <circle cx="58" cy="24" r="2.8" fill={palette.lime} />
    </>
  );
}

/** Compact icon / avatar. Stays readable down to ~20px. */
export function BrandIcon({
  theme = 'light',
  size = 32,
  title = 'Ai eo',
}: {
  theme?: BrandTheme;
  size?: number;
  title?: string;
}) {
  const gradientId = `aieo-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const palette = PALETTES[theme];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      focusable="false"
    >
      <title>{title}</title>
      <IconArt gradientId={gradientId} palette={palette} />
    </svg>
  );
}

/**
 * Horizontal navbar lockup: icon + rounded two-tone "Ai eo" wordmark.
 * `textLength` keeps the lockup width deterministic across platforms.
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
  const gradientId = `aieo-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const palette = PALETTES[theme];
  const width = Math.round((height * 184) / 64);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 184 64"
      role="img"
      aria-label={title}
      focusable="false"
    >
      <title>{title}</title>
      <IconArt gradientId={gradientId} palette={palette} />
      <text
        x="72"
        y="42"
        fontFamily={FONT_STACK}
        fontSize="33"
        fontWeight={800}
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
