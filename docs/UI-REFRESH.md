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

## 3. The question panel rebuilt

The question pane was the weakest surface in the product: a group header with a
type label and a range button, then every question as a plain row, with each
True/False question repeating three full-width option rows underneath it.

- **Instruction banner.** Every group now opens with a filled banner stating the
  range, the question type and the requirement, the way a printed paper does
  ("Questions 1–5 · True / False / Not Given · Do the following statements
  agree…"). The banner sits *outside* the question card so the requirement is
  read before the questions it governs, and the range doubles as a jump link.
- **Card of questions.** Questions live in one white card with hairline
  separators, a circular number badge inline with the statement, and a soft cyan
  wash on the active question.
- **Fixed: the duplicated True/False labels.** The options were built inline as
  `{ id: 'TRUE', text: 'TRUE' }` and the control printed *both* fields, so the
  interface read `TRUETRUE`, `FALSEFALSE` and `NOT_GIVENNOT GIVEN` — the stored
  token leaking next to its own label. The choices are now defined once, the
  control prints the label only, and True/False/Not Given and Yes/No/Not Given
  render as a compact segmented control instead of three stacked rows repeated
  under every statement.
- **Multiple choice** options became bordered rows with the letter in its own
  badge, so the option text is what the eye lands on.
- **Answer boxes live inside the sentence** for completion tasks. When a
  summary, note or table body carries the `[[n]]` placeholder for the question
  being rendered, the box is drawn at that position — number chip beside it,
  growing with the answer — and the other placeholders stay visible as muted
  numbers, exactly as the paper runs. Questions without an inline position keep
  the box below the prompt.
- Flags use the icon set, and the released-answer labels are humanised
  (`NOT_GIVEN` is displayed as `NOT GIVEN`).

## 4. Accessibility and behaviour preserved

- The segmented True/False control and the multiple-choice rows are real radio
  inputs (visually hidden, keyboard-reachable in group order), so arrow-key
  selection and screen-reader group semantics still work; the visual state is
  also carried by the label text, never by colour alone.
- Focus rings, keyboard paths, `prefers-reduced-motion`, semantic landmarks and
  the textual status labels are unchanged.
- Colour still never carries meaning alone: the navigator keeps its legend, the
  integrity indicator keeps a warning level, accuracy bars print their values.
- Contrast was re-checked for the new active rail item (cyan-700 on cyan-50) and
  for the small uppercase section labels (slate-400 on white, decorative only,
  duplicated by the nav group heading).

## 5. How this pass was verified

- `npm run typecheck`, `npm run lint`, `npm test` (158 unit tests) and
  `npm run build` are green.
- **Exam rendering check.** The same bundle was driven through a live attempt
  (created over the API against the seeded reading test) to assert the question
  panel itself: three groups render with their banners, each True/False question
  yields exactly three pills labelled `TRUE`, `FALSE`, `NOT GIVEN`, and the
  multiple-choice rows carry their letter badge. A second harness renders the
  component directly for the completion paths that the sample content does not
  exercise: the answer box lands inside the summary text and inside a table
  cell, and the head badge is suppressed when the number is already in the text.
- **Structural render check.** The SPA is bundled to an IIFE (jsdom cannot run
  ES modules) and rendered route by route in jsdom against the live Worker:
  landing, sign in, register, dashboard, practice catalogue, attempt history,
  analytics and profile all mount with the expected markup — sidebar items and
  icons, identity card, top-bar title, hero product still, skill cards and
  footer notice — and with no React console error. This proves the tree renders
  and the routes resolve; it does not evaluate layout, so pixel work still needs
  a browser.
- **Exam chrome check (second pass).** A live attempt against a 3-passage,
  40-question reading test (built through the Imports pipeline from
  `docs/samples/cities-knowledge-and-adaptation.json`) renders: three section
  tabs with their own counts, the sticky footer with palette / score / section
  tabs / Previous / Next, and a palette drawer holding all 40 numbered cells
  grouped under Passage 1–3 — with no React console error.
- **Review check.** The released result of the seeded reading attempt renders 13
  **Why these answers** panels with their evidence, explanation and answer, next
  to the `4 / 13` score.
- The deployed Worker is smoke-tested on every deploy by the same `/api/health`
  probe (`schemaReady: true`) used by `deploy/github-actions-deploy.yml`.

## 6. The exam chrome, sections and study tools (second pass)

The question panel was only half of the exam complaint. The chrome around it was
still a generic app header, and the test did not *look* divided into parts. This
pass rebuilt the frame and added the study features the reference has.

### 6.1 A test header, not an app header

- An exit control on the left opens **Leave the test?** — it states that answers
  are already saved, that timed sections keep running, and that leaving the tab
  is recorded, then routes back to the student workspace.
- The task is named ("Test in progress" eyebrow + the test title), with the
  answered counter (`12/40 answered`), the timer, the integrity indicator and
  Submit. The red **Học từ vựng** button opens the vocabulary notebook.
- Below it, a **section strip** lists every section as a tab with its own
  `answered/total` chip, a completed tick, a lock for parts that are not open
  yet and the per-section timer while that part is running. Locked parts cannot
  be opened by clicking; the button explains why in its tooltip.

### 6.2 A sticky exam footer

The reference keeps navigation at the bottom of the screen, so the exam does
too: a palette button (the question grid), **All questions**, the running score
`n / total`, one tab per section (`1`, `2`, `3`, and the current one expands to
its label and count), then **Previous** / **Next** — or **Continue to Part 3**
when the section policy moves the candidate on, which still asks for a second
confirming click.

**On "Làm đúng x / 40".** The reference counts correct answers while the test is
running because its client holds the key. Our payloads deliberately never carry
answer keys into a live attempt (they are released only with the result), so the
header and footer count *answered* questions and the accuracy figure appears on
the result screen. Shipping a live correct-answer counter would hand the key to
the browser.

### 6.3 Transcript as a conversation

Listening review now renders the transcript as alternating chat bubbles with a
speaker avatar, the line, and the timestamp — the layout the reference uses — and
the segments keep their `segment-<id>` anchors, so an explanation that cites
`segment:ls1-03` can scroll to it. Transcripts remain review material: the live
attempt payload still sends `transcript: null`.

### 6.4 Explanations under the review

The released review gained a **Why these answers** card: one block per question
with the number, the prompt, the candidate's answer, the accepted answer, and a
**Explanation** panel carrying the evidence, the reasoning and (for Listening) a
**Listen from here** button that seeks the section audio to the cited segment.

### 6.5 The vocabulary notebook

**Học từ vựng** now opens a real feature rather than a dead end: a per-candidate
word list (D1 table `vocabulary_entries`, unique on `(user_id, term)`) with
add / edit meaning / delete, search, a "words still to review" prompt and a
self-test flip card that records how often a word was reviewed. Mutations are
CSRF-protected like every other write. The authoring side is documented in
[`docs/QUESTION-AUTHORING.md`](QUESTION-AUTHORING.md).

## 7. Deliberately not changed

- No new runtime dependency (the icon set and the tokens are hand-written).
- No dark mode. The product is a light workspace by decision; a theme toggle
  would double the surface area of every screen for no requirement behind it.
- Still no live correct-answer counter, for the reason in §6.2.
