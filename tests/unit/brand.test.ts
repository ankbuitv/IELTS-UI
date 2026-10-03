import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrandIcon, BrandLogo, BrandMark } from '../../src/client/components/BrandLogo';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Guardrails for the "Ai eo" identity: the components must render the
 * three-bar mark and the lowercase wordmark in the agreed palette, and the
 * shipped SVG assets must stay well-formed, on-palette and free of any
 * official-exam branding.
 */
describe('Ai eo brand components', () => {
  it('renders the horizontal lockup in every theme', () => {
    for (const theme of ['light', 'dark', 'brand', 'auto'] as const) {
      const html = renderToStaticMarkup(createElement(BrandLogo, { theme, height: 36 }));
      expect(html).toContain('viewBox="0 0 184 64"');
      expect(html).toContain('aria-label="Ai eo"');
      expect(html).toContain('<title>Ai eo</title>');
    }
  });

  it('uses the agreed palette: brand-red mark, navy ink, white on red', () => {
    const light = renderToStaticMarkup(createElement(BrandLogo, { theme: 'light' }));
    expect(light).toContain('#E1251B');
    expect(light).toContain('#14233A');

    const dark = renderToStaticMarkup(createElement(BrandLogo, { theme: 'dark' }));
    expect(dark).toContain('#FF4D4D');
    // The wordmark turns white on a dark surface.
    expect(dark).not.toContain('#14233A');

    const brand = renderToStaticMarkup(createElement(BrandLogo, { theme: 'brand' }));
    // On a red surface the whole mark turns white.
    expect(brand).toContain('#FFFFFF');
  });

  it('draws the lockup as paths, never as text that depends on an installed font', () => {
    const html = renderToStaticMarkup(createElement(BrandLogo, { theme: 'light' }));
    expect(html).not.toContain('<text');
    expect(html).not.toContain('<tspan');
    expect(html).not.toContain('font-family');
  });

  it('follows the CSS variables in the "auto" theme, so one header serves light and dark mode', () => {
    const html = renderToStaticMarkup(createElement(BrandLogo, { theme: 'auto' }));
    for (const name of ['--logo-bars', '--logo-ink', '--logo-dot']) {
      expect(html).toContain(`var(${name})`);
    }
    // The tile variable only appears on the icon, which is the only theme-aware tile.
    const icon = renderToStaticMarkup(createElement(BrandIcon, { theme: 'auto' }));
    expect(icon).toContain('var(--logo-tile)');
    // The variables are applied through `style`: var() is not reliable inside SVG attributes.
    expect(html).not.toMatch(/fill="var\(/);
    expect(html).not.toMatch(/stroke="var\(/);
  });

  it('renders the compact icon and the bare mark', () => {
    const light = renderToStaticMarkup(createElement(BrandIcon, { theme: 'light', size: 32 }));
    const dark = renderToStaticMarkup(createElement(BrandIcon, { theme: 'dark', size: 32 }));
    expect(light).toContain('viewBox="0 0 64 64"');
    expect(dark).toContain('viewBox="0 0 64 64"');
    // Themes must actually differ (the dark variant uses the brightened red).
    expect(light).not.toBe(dark);

    const mark = renderToStaticMarkup(createElement(BrandMark, { theme: 'brand', size: 96 }));
    expect(mark).toContain('viewBox="0 0 64 64"');
  });
});

describe('Ai eo brand assets', () => {
  const files = [
    'src/client/public/brand/aieo-horizontal-light.svg',
    'src/client/public/brand/aieo-horizontal-dark.svg',
    'src/client/public/brand/aieo-icon.svg',
    'src/client/public/brand/aieo-icon-dark.svg',
    'src/client/public/favicon.svg',
  ];

  it('ships all five standalone SVG assets, well-formed and on-brand', () => {
    for (const file of files) {
      expect(existsSync(join(repoRoot, file)), file).toBe(true);
      const svg = readFileSync(join(repoRoot, file), 'utf8');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('<title>Ai eo</title>');
      // Current palette: the light red or its dark-surface sibling.
      expect(svg, file).toMatch(/#(E1251B|FF4D4D)/i);
      // Earlier palettes must not come back: cyan, and the previous crimson.
      expect(svg).not.toMatch(/#(22d3ee|06b6d4|0891b2|67e8f9|0e7490)/i);
      expect(svg).not.toMatch(/#(C8102E|E0243F|A50D26|FF6B7D|D3222B|E5343C)/i);
      // The artwork never prints an exam name; the only mention is the disclaimer.
      expect(svg.replace('No affiliation with IELTS, British Council, IDP or Cambridge.', '')).not.toMatch(/IELTS/);
      // Every asset carries the non-affiliation note.
      expect(svg).toContain('No affiliation with IELTS');
    }
  });

  it('ships the share image and the touch icon at their required sizes', () => {
    const pngSize = (file: string) => {
      const bytes = readFileSync(join(repoRoot, file));
      // PNG signature, then the IHDR chunk: width and height are big-endian 32-bit integers at 16 and 20.
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    };
    expect(pngSize('src/client/public/og-image.png')).toEqual({ width: 1200, height: 630 });
    expect(pngSize('src/client/public/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });

  it('points the page head at those files', () => {
    const html = readFileSync(join(repoRoot, 'src/client/index.html'), 'utf8');
    expect(html).toContain('href="/apple-touch-icon.png"');
    expect(html).toContain('href="/favicon.svg"');
    expect(html).toContain('/og-image.png');
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('name="theme-color" content="#ffffff"');
  });
});
