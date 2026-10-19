import { readdirSync, readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Hero, PageHead, Ring, Row, Section, StatPill } from '../../src/client/components/page';

/**
 * The page kit is the only layer every screen is built from, so it is worth a
 * test: a broken class here silently restyles the whole product.
 */
const render = (element: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/x'] }, element));

describe('PageHead', () => {
  it('renders the eyebrow, title, meta and actions in the kit structure', () => {
    const html = render(
      createElement(PageHead, {
        eyebrow: 'Catalogue',
        title: 'Practice',
        meta: 'Pick a test.',
        actions: createElement('button', null, 'Go'),
      }),
    );
    expect(html).toContain('class="ph"');
    expect(html).toContain('ph__eyebrow');
    expect(html).toContain('<h1>Practice</h1>');
    expect(html).toContain('ph__meta');
    expect(html).toContain('ph__actions');
  });

  it('omits the optional slots instead of printing empty wrappers', () => {
    const html = render(createElement(PageHead, { title: 'Only a title' }));
    expect(html).not.toContain('ph__eyebrow');
    expect(html).not.toContain('ph__meta');
    expect(html).not.toContain('ph__actions');
  });
});

describe('Section', () => {
  it('picks the container that matches the layout', () => {
    const body = createElement('div', { className: 'x' });
    expect(render(createElement(Section, { title: 'T', layout: 'grid', cols: 3, children: body }))).toContain('sec__grid--3');
    expect(render(createElement(Section, { title: 'T', layout: 'list', children: body }))).toContain('rowlist');
    expect(render(createElement(Section, { title: 'T', layout: 'tiles', children: body }))).toContain('module-tiles');
    expect(render(createElement(Section, { title: 'T', children: body }))).toContain('class="x"');
  });

  it('carries the tone onto the section so the accent colour follows', () => {
    expect(render(createElement(Section, { title: 'T', tone: 'amber', children: 'x' }))).toContain('sec--amber');
  });
});

describe('Ring', () => {
  it('maps the value onto a 0-100 arc length instead of a measured circumference', () => {
    const html = render(createElement(Ring, { value: 6.5, max: 9, label: 'Band', display: '6.5' }));
    expect(html).toContain('--pct:72.22222222222221');
    expect(html).toContain('stroke-dasharray="72.22222222222221 100"');
    expect(html).toContain('ring--brand');
    expect(html).toContain('>6.5<');
  });

  it('clamps a value outside the range so the arc never overruns', () => {
    const html = render(createElement(Ring, { value: 130, max: 100 }));
    expect(html).toContain('--pct:100');
    expect(render(createElement(Ring, { value: -8, max: 100 }))).toContain('--pct:0');
  });

  it('survives a zero maximum without dividing by zero', () => {
    expect(render(createElement(Ring, { value: 3, max: 0 }))).toContain('--pct:0');
  });
});

describe('Row', () => {
  it('becomes a link when it has a destination and a button otherwise', () => {
    const linked = render(createElement(Row, { title: 'Due soon', href: '/a', index: 2 }));
    expect(linked).toContain('<a class="row"');
    expect(linked).toContain('--i:2');
    const pressed = render(createElement(Row, { title: 'Toggle', onClick: () => undefined, index: 4 }));
    expect(pressed).toContain('<button type="button" class="row"');
    expect(pressed).toContain('--i:4');
  });

  it('prints a chevron only when nothing else already sits on the right', () => {
    expect(render(createElement(Row, { title: 'T', chevron: true }))).toContain('row__chev');
    expect(render(createElement(Row, { title: 'T', chevron: true, right: 'x' }))).not.toContain('row__chev');
  });
});

describe('kit CSS', () => {
  const styleDir = new URL('../../src/client/styles/', import.meta.url);
  const css = readdirSync(styleDir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(new URL(name, styleDir), 'utf8'))
    .join('\n');
  /** Kit-owned names only: shared classes (`icon`, `btn`) are themed by their parent. */
  const isKitClass = (name: string) => /^(ph|sec|row|rowlist|ring|pill-stat|hero-panel|module-tiles?|stagger|switch-chip|pill-strip)(_|--|-)?/.test(name);

  it('styles every class the kit emits, so pages cannot lose their layout silently', () => {
    const html = [
      render(createElement(PageHead, { eyebrow: 'E', title: 'T', meta: 'M', actions: 'A' })),
      render(createElement(Section, { title: 'T', layout: 'grid', children: 'x' })),
      render(createElement(Section, { title: 'T', tone: 'teal', layout: 'list', children: 'x' })),
      render(createElement(Ring, { value: 1, label: 'L' })),
      render(createElement(Row, { title: 'T', icon: 'book', tone: 'info', href: '/a' })),
      render(createElement(StatPill, { label: 'x', value: 1, icon: 'coin', tone: 'amber' })),
      render(createElement(Hero, { kicker: 'K', title: 'T', lede: 'L', bars: true, aside: 'A' })),
    ].join('');
    const classes = new Set(
      [...html.matchAll(/class="([^"{]+)"/g)].flatMap((match) => (match[1] ?? '').split(/\s+/)).filter(Boolean),
    );
    expect(classes.size).toBeGreaterThan(12);
    const kit = [...classes].filter(isKitClass);
    expect(kit.length).toBeGreaterThan(8);
    for (const name of kit) {
      expect(css, `the stylesheets are missing a rule for .${name}`).toMatch(new RegExp(`\\.${name}[\\s,{:.>\\[]`));
    }
  });
});
