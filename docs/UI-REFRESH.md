# Interface refresh — a light, product-first workspace

Scope: one visual pass over the existing interface, with **no functional change**.
Every route, class name, form, policy and server contract is unchanged; what
changed is the visual language: a light application shell, a real icon set, a
landing page that shows the product, and one consistent surface treatment.

Direction: a light SaaS workspace — white surfaces on a cool canvas, hairline
borders, soft shadows, cyan primary with a violet secondary accent, icons on
navigation, and generous but disciplined type.

---

## 1. What was wrong before

- **Two visual languages in one product.** The stylesheet documented a
  "predominantly white" workspace with a white sidebar, but the sidebar, the
  sign-in rail and the marketing footer all rendered a deep teal gradient. Half
  the app looked like a dark console bolted onto a light interface.
- **Navigation without icons.** Every rail item was text only, so the sidebar
  had to be read rather than scanned, and the only glyphs in the product were
  emoji used as feature icons on the landing page.
- **A landing page that described the product instead of showing it.** The hero
  carried a list of four rows where a product still belongs.
- **Inconsistent radii and shadows.** Corner radii ran from 8px to 26px and
  shadows were asymmetric across cards, buttons and modals.
- **Dead CSS.** A duplicated `.public-footer__notice` rule (two blocks, the
  later silently winning) and dark-surface tokens referenced by nothing.

## 2. What changed

**Tokens (`src/client/styles/globals.css`).** Radii tightened to a 8/12/16/22
scale, three shadow levels rebuilt around slate-based transparency, a
`--gradient-accent` (cyan → violet) added, the `--deep-*` dark-surface tokens
and `--gradient-deep` removed with their last consumers, and the body no longer
paints two fixed radial washes behind every page.

**Application shell (`AppShell.tsx`).** The rail is now white with hairline
borders: grouped sections (Study, Workspace), an icon per item, a soft cyan tint
plus a light ring for the active item, and a signed-in **identity card** at the
bottom with an initials avatar and a one-click sign out. The top bar carries the
current section name (derived from the route) instead of a static string, a
primary "Start practising" action, and the account avatar. The mobile drawer is
labelled as a dialog, closes on Escape and now also closes when the viewport
returns to the desktop breakpoint, so the backdrop can never cover a page whose
rail is visible.

**Icon set (`components/Icon.tsx`).** A dependency-free stroke set on a 24×24
grid (navigation, actions, status and skills). One visual language replaces the
emoji, and because icons always sit beside a text label they are `aria-hidden`
by default; `label` is available for icon-only controls.

**Landing page (`pages/auth/PublicPages.tsx`).** The hero now shows a still of
the product: window chrome, a quiet sidebar, three metric tiles and the four
skill rows, followed by an honest note about estimated bands. Section heads
gained eyebrows, skill cards and features gained icons, and the footer moved
from a dark slab to a light column layout.

**Sign-in / register (`globals.css`).** The split screen survives, but the brand
rail is now a light tinted panel with the same cyan/violet wash and hairline
grid, so the auth pages match the rest of the product. The password policy
meter, bootstrap-admin notice and inline reveal toggle are untouched.

**Everywhere else.** Cards, stats, buttons, inputs, badges, tables, tabs,
sub-navigation, modals, toasts and the exam shell keep their structure and
inherit the tightened tokens; the exam screen deliberately stays the calmest
surface in the product.

## 3. Accessibility and behaviour preserved

- Focus rings, keyboard paths, `prefers-reduced-motion`, semantic landmarks and
  the textual status labels are unchanged.
- Colour still never carries meaning alone: the navigator keeps its legend, the
  integrity indicator keeps a warning level, accuracy bars print their values.
- Contrast was re-checked for the new active rail item (cyan-700 on cyan-50) and
  for the small uppercase section labels (slate-400 on white, decorative only,
  duplicated by the nav group heading).

## 4. How this pass was verified

- `npm run typecheck`, `npm run lint`, `npm test` (158 unit tests) and
  `npm run build` are green.
- **Structural render check.** The SPA is bundled to an IIFE (jsdom cannot run
  ES modules) and rendered route by route in jsdom against the live Worker:
  landing, sign in, register, dashboard, practice catalogue, attempt history,
  analytics and profile all mount with the expected markup — sidebar items and
  icons, identity card, top-bar title, hero product still, skill cards and
  footer notice — and with no React console error. This proves the tree renders
  and the routes resolve; it does not evaluate layout, so pixel work still needs
  a browser.
- The deployed Worker is smoke-tested on every deploy by the same `/api/health`
  probe (`schemaReady: true`) used by `deploy/github-actions-deploy.yml`.

## 5. Deliberately not changed

- No new runtime dependency (the icon set and the tokens are hand-written).
- No layout rewrites of the exam, admin or teacher screens: they inherit the
  tokens. Restructuring them without a browser to check the result would trade a
  known-good layout for an unverified one.
- No dark mode. The product is a light workspace by decision; a theme toggle
  would double the surface area of every screen for no requirement behind it.
