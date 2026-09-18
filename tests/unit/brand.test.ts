import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrandIcon, BrandLogo } from '../../src/client/components/BrandLogo';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Guardrails for the original "Ai eo" identity: the lockups must render with
 * the exact wordmark, and the shipped SVG assets must stay well-formed,
 * on-palette, and free of any official-exam branding.
 */
describe('Ai eo brand assets', () => {
  it('renders the horizontal lockup with the exact "Ai eo" wordmark', () => {
    for (const theme of ['light', 'dark'] as const) {
      const html = renderToStaticMarkup(createElement(BrandLogo, { theme, height: 36 }));
      expect(html).toContain('viewBox="0 0 184 64"');
      expect(html).toContain('aria-label="Ai eo"');
      // Two-tone wordmark: "Ai " and "eo" in separate tspans.
      expect(html).toContain('>Ai </tspan>');
      expect(html).toContain('>eo</tspan>');
    }
  });

  it('renders the compact icon in both themes', () => {
    const light = renderToStaticMarkup(createElement(BrandIcon, { theme: 'light', size: 32 }));
    const dark = renderToStaticMarkup(createElement(BrandIcon, { theme: 'dark', size: 32 }));
    expect(light).toContain('viewBox="0 0 64 64"');
    expect(dark).toContain('viewBox="0 0 64 64"');
    // Themes must actually differ (dark variant uses brightened tokens).
    expect(light).not.toBe(dark);
  });

  it('ships all five standalone SVG assets, well-formed and on-brand', () => {
    const files = [
      'src/client/public/brand/aieo-horizontal-light.svg',
      'src/client/public/brand/aieo-horizontal-dark.svg',
      'src/client/public/brand/aieo-icon.svg',
      'src/client/public/brand/aieo-icon-dark.svg',
      'src/client/public/favicon.svg',
    ];
    for (const file of files) {
      const svg = readFileSync(join(repoRoot, file), 'utf8');
      expect(existsSync(join(repoRoot, file))).toBe(true);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('Ai eo');
      // Original palette only: cyan family + violet/lime accents, never red.
      expect(svg).toMatch(/#(22d3ee|06b6d4|0891b2|67e8f9|0e7490)/);
      expect(svg).not.toMatch(/#(e11d48|be123c|ef4444|dc2626)/i);
      // Every asset carries the non-affiliation note.
      expect(svg).toContain('No affiliation with IELTS');
    }
  });
});
