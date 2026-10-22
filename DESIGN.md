# Design

<!-- impeccable:design-schema 1 -->

## World

**Catppuccin** (owner-pinned 2026-10-22 via the structured question,
"catpuccin"). Flavour mapping is a rule, not a mood: the **Latte** (light)
flavour skins every app surface; the **Mocha** (dark) flavour skins the call
room, the dark bands/footer, and the user-selectable dark display theme
(`refresh.css`, DisplayMenu). This pin revokes the Character Goods Catalog look
of 2026-10-21 (itself a revocation of the earlier computer-IELTS pin); all three
records live in `PRODUCT.md → Brand Commitments`.

World rule: the world lends **type, palette, density and one signature move** —
never layout, navigation or controls (Operate mode). The signature move here is
**the mauve commitment**: exactly one saturated colour (mauve) owns every
"current/primary/active" state on a cool tinted ground; the four skill cells are
tinted pastels derived from their role hues, so data colours are world colours.

## Colour tokens (source of truth: `src/client/styles/globals.css`)

| Role | Token(s) | Value | Job |
| --- | --- | --- | --- |
| brand | `--brand-50…800`, `--brand-edge` | mauve `#8839ef` (600, white 5.4:1), hover `#7530d1`, text `#5f27aa`, tints `#f4ecfe → #dcc5fb` | primary buttons, active nav pill, current item, focus accents |
| ground | `--canvas` / `--paper` / `--paper-muted` | `#eff1f5` / `#ffffff` / `#f6f8fc` | page ground, cards, nested surfaces |
| ink | `--ink-950…50` | `#34364a`, `#4c4f69`, `#5c5f77`, `#6c6f85` (body), `#8c8fa1`, `#9ca0b0`, `#acb0be`, `#ccd0da`, `#e6e9ef`, `#eff1f5` | headings → body → muted → rules → soft fills (Latte slate, blue-tinted — never pure grey) |
| bar / mocha | `--bar`, refresh dark theme | `#1e1e2e` base, `#181825` mantle, `#11111b` crust, `#313244` surface0, `#45475a` surface1, `#cdd6f4` text, `#a6adc8` subtext | footer, exam dark bands, call room chrome, dark theme |
| cells | `--lilac/--mint/--sky/--butter` | `#ece4fb` (mauve), `#e0efe4` (green), `#e2ebfa` (blue), `#f8ecd6` (gold) | pastel skill/data cell fills (tints of the four role hues) |
| info | `--info*` | `#1e66f5` | Reading, links |
| teal | `--teal*` | `#0b7a75` | Listening |
| amber | `--warning*` | `#b35408`, soft `#fdeedd` | Writing, pending, flagged |
| violet† | `--violet*` | `#a63174` (deep pink) | Speaking |
| success | `--success*` | `#2f7d1f`, soft `#e4f3de` | correct, published |
| danger | `--danger*` | `#d20f39`, soft `#fde5ea` | errors, destructive, overdue |
| sun | `--sun-*` | gold `#df8e1e` (600), fill `#eeae3a`, soft `#fdf3e2` | streaks, XP, stars |
| fills | `--fill-* / --edge-*` | listening `#179299`, reading `#1e66f5`, writing `#df8e1e`, speaking `#d4539f` | icon tiles, path nodes, bars |
| coral | `--coral-*` | peach `#fe7a45` | flame/hearts accents |

† named `violet` historically; the hue is Catppuccin-pink-derived so Speaking
never collides with the mauve brand.

Shadows are blue-tinted slate with a real offset: `--shadow-sm`
`0 6px 18px rgba(76,79,105,.09)`; tactile buttons add a `0 2px 0` lip in
`--brand-edge`. No zero-offset coloured halos (except the documented
`--shadow-brand`, which keeps a 10px offset).

## Type

**Be Vietnam Pro** (SIL OFL 1.1, self-hosted via `@fontsource`, woff2 only,
subsets vietnamese/latin/latin-ext with unicode-range — Vietnamese diacritics
are a product fact, not a nice-to-have). One family across the scale:
display = 700/800 at −0.03em (h1, KPI numerals, tabular figures), body = 500,
labels = 600/700 uppercase 0.07em. Fallbacks: system-ui stack. Replaces
Baloo 2 + Quicksand (the catalogue world's rounded pair).

## Shape & motion

Radii: 10 / 14 / 20 / 24 / pill. Buttons are pills with a 2px darker lip.
Motion: `--speed: 140ms`, `--ease: ease-out`, functional only (state changes,
menus, bars) — no decorative loops.

## Components

- **Shell**: 76px icon rail (≥1080px), six items, mauve active pill, hover
  names via `data-label`; everything else grouped behind "More". Phone keeps a
  tab bar; both viewports reach every feature (nothing is hidden).
- **Buttons**: primary = solid mauve + lip; secondary = solid ink; ghost,
  danger, success, sun variants; all pill.
- **Cards**: white on Latte, 14–20px radius, hairline `--ink-200` or fill-based
  separation; nested = `--paper-muted`.
- **Call room**: Mocha chrome, mauve/lavender accents (`#cba6f7`), Latte-blue
  primary actions (`#1e66f5`), red hang-up (`#d20f39`).

## Invariants

No emoji in UI. No gradients-as-decoration, glass or glow. Original SVG mark
(`BrandLogo`) and one original icon set. Every band labelled "estimate, not
official". No fabricated claims. Vietnamese-first copy. Self-hosted woff2 only.
No affiliation with IELTS / British Council / IDP / Cambridge.

## Change log

- 2026-10-22 — world replaced: Character Goods Catalog → **Catppuccin**
  (Latte app / Mocha dark + call room); type Baloo 2 + Quicksand →
  Be Vietnam Pro; tokens, hardcoded hexes across `src/client/styles/*`, the
  app dark theme and the call room remapped; certificate carries the mark.
