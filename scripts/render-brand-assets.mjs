#!/usr/bin/env node
/**
 * Renders the brand PNGs from the SVG artwork.
 *
 * The SVGs in `src/client/public` are the source of truth: every PNG here is
 * rasterised from them, so the two can never drift apart the way hand-exported
 * images do. Run it after changing any brand SVG (`node scripts/render-brand-assets.mjs`).
 *
 *   favicon-32.png / favicon-192.png  the bare mark, transparent, for browsers
 *                                     that do not read an SVG favicon
 *   apple-touch-icon.png              the mark on a white tile — iOS ignores
 *                                     transparency and wants a square PNG
 *   og-image.png                      the share card: the lockup on a light
 *                                     field, drawn entirely from paths so it
 *                                     looks the same wherever it is rendered
 *
 * Nothing here needs a font installed: the wordmark is vector paths, not text.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = `${root}/src/client/public`;

const MARK = (colour) => `
  <rect x="12" y="32" width="9" height="20" rx="4.5" fill="${colour}"/>
  <circle cx="16.5" cy="21" r="4.5" fill="${colour}"/>
  <rect x="27.5" y="12" width="9" height="40" rx="4.5" fill="${colour}"/>
  <rect x="43" y="22" width="9" height="30" rx="4.5" fill="${colour}"/>`;

const WORDMARK = (ink, dot) => `
  <g transform="translate(77 31) scale(0.8667)">
    <g fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 0a11 11 0 1 0 22 0a11 11 0 1 0 -22 0"/>
      <path d="M26 -11V11"/>
      <path d="M38.5 -11V11"/>
      <path d="M77.57 8.43A11 11 0 1 1 81.44 -1.15"/>
      <path d="M94 0a11 11 0 1 0 22 0a11 11 0 1 0 -22 0"/>
      <path d="M59.5 0H82.5" stroke-width="5.4" stroke-linecap="butt"/>
    </g>
    <circle cx="38.5" cy="-25.5" r="5" fill="${dot}"/>
  </g>`;

const svg = (viewBox, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;

/** Rasterises an SVG string at a high density, so small sizes stay crisp. */
async function render(source, file, width, height) {
  const buffer = await sharp(Buffer.from(source), { density: 600 })
    .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  writeFileSync(`${publicDir}/${file}`, buffer);
  console.log(`  ✓ ${file} ${width}×${height} (${buffer.length} bytes)`);
}

const bareMark = svg('0 0 64 64', MARK('#E1251B'));
const tiledMark = svg('0 0 64 64', `<rect width="64" height="64" rx="16" fill="#FFFFFF"/>${MARK('#E1251B')}`);

/**
 * The share card: the horizontal lockup centred on a light field between two
 * red rules. Everything is vector paths — no text — so it renders identically
 * wherever the platform that displays it happens to be.
 */
const lockup = `${MARK('#E1251B')}${WORDMARK('#14233A', '#E1251B')}`;
// The lockup is 184 x 64 units; at 3.4x it is 626 x 218, centred in 1200 x 630.
const ogImage = svg(
  '0 0 1200 630',
  `
  <rect width="1200" height="630" fill="#F8FAFC"/>
  <rect width="1200" height="12" fill="#E1251B"/>
  <rect y="618" width="1200" height="12" fill="#E1251B"/>
  <g transform="translate(287 206) scale(3.4)">${lockup.replace(/\s+/g, ' ')}</g>`,
);

console.log('▸ Rendering brand PNGs from the SVG artwork');
await render(bareMark, 'favicon-32.png', 32, 32);
await render(bareMark, 'favicon-192.png', 192, 192);
await render(tiledMark, 'apple-touch-icon.png', 180, 180);
await render(ogImage, 'og-image.png', 1200, 630);
console.log('✓ Done.');
