# Visual modernisation + removal of object storage (R2)

Scope: one implementation pass on top of V1. It modernises the interface and
removes Cloudflare R2 from the default product path. No V1 feature was removed,
and the test, import and marking architecture was only changed where object
storage removal required it.

Branch: `arena/01a0b3be-ielts-ui` · Worker + client typecheck, lint, unit tests,
production build and the HTTP acceptance run are all green (§9, §10).

---

## 1. Major visual changes

- **Predominantly white interface.** The canvas is now `#f6f8fb` with white
  surfaces, hairline `slate-200` borders and very soft shadows. The old dark
  navy hero, the navy primary colour and the grey "Meridian" chrome are gone.
- **Landing page rebuilt.** Light hero with a restrained cyan/violet radial
  wash, an eyebrow badge, product copy, two CTAs, a "what a session looks like"
  preview card, four skill preview cards, a teacher/classroom section, a feature
  grid and a three-column footer. The non-affiliation notice moved into the
  footer as secondary text instead of dominating the hero.
- **New application shell.** Desktop gets a white sticky sidebar plus a light
  top bar; tablet and phone get a drawer with a backdrop and a hamburger. Public
  pages render without the sidebar so the marketing layout stays full width.
- **Dashboard cards.** Stat cards gained an icon tile and a colour accent
  (Reading cyan, Listening violet, Writing amber, Full mock emerald, activity
  blue) so analytics are multi-colour and quickly scannable instead of one hue.
- **Exam shell modernised, deliberately calm.** White top bar with test info,
  section progression, autosave state, integrity indicator, answered count with a
  slim progress bar and an explicit "Submit test" button. The Reading panes keep
  the 53% / 47% split with independent scrolling and a hairline divider.
- **Question navigator.** Unanswered = neutral, answered = cyan, current = solid
  cyan with a ring, flagged = amber. A small legend above the strip explains the
  states in words so colour is never the only signal. Correctness colours still
  appear only in the released review.
- **Listening audio panel.** A purpose-built panel (play control, progress track,
  elapsed/total time, policy line) instead of the browser's stock player, and it
  no longer resembles a music-streaming app.
- **Writing screen.** Quiet document surface, Task 1/Task 2 tabs, prompt card,
  live word count with a "Length requirement met" / "Below the minimum length"
  badge and autosave feedback in the top bar.
- **Full mock.** A Listening → Reading → Writing progression indicator
  (done / current / remaining) replaces the bare "Section 2 of 3" badge.
- **Admin console.** A professional CMS feel: segmented sub-navigation,
  status badges (DRAFT neutral, REVIEW amber, PUBLISHED emerald, ARCHIVED
  dimmed), pipeline-coloured import statuses and forms already grouped into
  section cards.
- **Typographic hierarchy.** Bigger, tighter page and card titles, uppercase
  metadata labels at readable sizes, sentence-case body text and no tiny text for
  important controls.

## 2. Design tokens and components introduced or changed

**Tokens (`src/client/styles/globals.css`, rewritten).** `--brand-50…700`
(cyan), `--ink-950…50` (slate), and state tokens for success (emerald), danger
(rose), warning (amber), info (blue) and violet; radii 8/12/16/22; three shadow
levels; `--focus-ring`/`--focus-border` in cyan; `--speed: 180ms` with one shared
easing curve; `--sidebar-width`; a modern sans stack (the passage now uses the UI
sans with a 1.9 line-height and a 68ch measure).

**Kit (`src/client/components/ui.tsx`).**

- Added: `IconButton`, `Radio`, `Tooltip`, `Skeleton`, `Pagination`.
- Changed: `Button` gained `secondary`/`success` variants and an `icon` size;
  `Badge` gained `violet`/`dim` tones, a status dot and a `plain` option;
  `Stat` gained `icon` and `accent`; `Card` gained `interactive`;
  `ProgressBar` gained a `violet` tone.
- Already present and re-skinned: Button, Field, TextInput, TextArea, Select,
  Checkbox, Card, Badge, Notice (alert), EmptyState, Loading, Modal, Tabs,
  ToastProvider/useToast, KeyValue, ConfirmButton, Table (`table.data`).

**Charts (`src/client/components/charts.tsx`)** accept a `tone`
(`brand`/`violet`/`emerald`/`amber`/`blue`), and `AccuracyList` items can carry a
per-skill tone. Progress fills use semantic colours with the value printed beside
them.

## 3. Pages modernised

Landing, sign-in/register/join/not-found; student dashboard, attempt history,
result review, classrooms, analytics, profile; teacher home, classroom,
assignment and student detail; the full admin console (dashboard, tests, test
editor, imports, scoring profiles, attempts, users, settings/media); the exam
shell for Reading, Listening, Writing and the full mock. Exam and public pages
were restructured; the remaining pages inherit the new system through the shared
kit and stylesheet.

## 4. Responsive improvements

- Sidebar → drawer below 1024px with a closing backdrop, Escape support and
  `visibility: hidden` while closed (no off-screen tab stops).
- Reading/Listening panes stack below 960px and switch to the Passage/Questions
  tabs; the question navigator wraps; the exam footer wraps on small screens.
- Single-column dashboards and grids at 720px/1180px; compact card padding and
  smaller headings on phones; modals fit the viewport with internal scrolling.
- Tables scroll horizontally inside `.table-wrap`; long lists use badges and
  aligned numeric columns rather than squeezed text.
- Public hero switches from two columns to one below 960px; the marketing top-bar
  links collapse on phones.

## 5. Accessibility improvements

- A visible cyan focus ring on every interactive element, applied through
  `:focus-visible`, including custom rows and navigator buttons.
- `prefers-reduced-motion` disables transitions, animations and shimmer.
- Status is always textual: badges carry labels beside their dots, the navigator
  has a legend, accuracy bars print the percentage, integrity shows counts and a
  warning level.
- Semantic landmarks retained/added (`aside`, `nav` with labels, `role=dialog`
  with an accessible name, progressbar roles on bars and the audio track,
  `aria-label`s on icon-only buttons).
- Contrast: text uses slate-950/800/600 on white, cyan-700 for links and accents,
  and amber/rose text colours are darkened for small text.

## 6. R2 code and configuration removed

- `migrations/0003_url_assets.sql`: `assets` rebuilt around `storage_kind`
  (`EXTERNAL_URL` default, `BUNDLED`, future `OBJECT_STORAGE`), `external_url`,
  optional unique `r2_key` (placeholder for a future adapter only) and
  `updated_at`; `imports.source_text` stores extracted text in D1.
- `src/worker/env.ts`: `CONTENT_BUCKET` binding deleted; new
  `src/worker/services/media-service.ts` is the single resolver
  (`resolveAssetUrl`, `normaliseExternalUrl`, `hasObjectStorage() → false`).
- `src/worker/routes/files.ts`: `/api/files/:id` authorises and returns a 302 to
  the registered HTTPS URL (no streaming, no range requests).
- `src/worker/services/import-service.ts`: imports process in the request — text
  extraction is stored in D1 and the binary is discarded; new `createTextImport`
  and `createStructuredImport`; `loadImportDetail` no longer exposes an asset.
- `src/worker/routes/imports.ts`: `GET /:id/extracted` reads D1 and
  `POST /api/imports/paste` accepts pasted text or JSON.
- `src/worker/routes/admin.ts`: `POST /assets` registers an external HTTPS URL,
  `PATCH /assets/:id` accepts `url`, `DELETE` no longer removes an object.
- `src/worker/services/content-service.ts`: candidate audio is exposed only when
  a URL resolves; the player keeps the authorised `/api/files/:id` redirect.
- `wrangler.jsonc`: the `r2_buckets` block is gone.
- Client: the admin assets panel and the audio picker now take a URL, and the
  imports page offers "Paste text or JSON" next to the document upload.

**Also in this pass.** Structured Reading import validation now detects answer
fields leaked into student-visible content, duplicate/missing question numbers,
malformed and overlapping ranges, answer keys that reference options which do not
exist, invalid word limits, malformed evidence, duplicate paragraph labels,
exactly duplicated paragraph text, and a declared `passageWordCount` that
disagrees with the text. Word counts are recomputed from the text server-side and
a declared count is only ever reported as a warning from the apply response.
Where evidence contains an explicit quotation, that quotation must appear
verbatim in the referenced passage. 18 new unit tests cover these checks, and the
acceptance run exercises the paste → review → draft path end-to-end.

## 7. Remaining optional object-storage references

- `assets.r2_key` — nullable, unique, unused by V1 code; reserved so a future
  adapter can migrate rows without a schema rewrite.
- `hasObjectStorage()` in `src/worker/services/media-service.ts` — returns
  `false`; the documented seam for a future adapter.
- `storage_kind = 'OBJECT_STORAGE'` in the schema check constraint — unresolvable
  in V1, so such a row yields no URL instead of a runtime error.
- One explanatory comment in `wrangler.jsonc` stating that no bucket or R2
  billing is required.
- No Worker route, service, client page, script, test or migration depends on any
  of the above.

## 8. Current required Cloudflare bindings

| Binding | Type | Name | Notes |
| --- | --- | --- | --- |
| `DB` | D1 | `ielts-platform-db` | required; local id works, remote id is still `REPLACE_WITH_D1_DATABASE_ID` |
| `ASSETS` | Static assets | `dist/client` | required; `run_worker_first: ["/api/*"]` |
| `IMPORT_QUEUE` | Queue producer | `ielts-import-jobs` | optional; falls back to inline processing |
| `ielts-import-jobs` / `…-dlq` | Queue consumer + DLQ | — | optional, same as above |
| Cron `*/30 * * * *` | Scheduled handler | — | housekeeping |
| `SESSION_SECRET` | Secret | — | required |
| `OPENAI_API_KEY` | Secret | — | optional; absent → manual import only |

No R2 bucket, no R2 binding and no R2 billing are part of local or production
startup.

## 9. Commands executed

```
npx tsc -p tsconfig.client.json --noEmit
npx tsc -p tsconfig.worker.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npx eslint .
npx vitest run tests/unit
npx vite build
node scripts/reset-local-db.mjs
node scripts/integration.mjs | tee docs/acceptance-run.txt
curl http://127.0.0.1:8787/api/health   # and /, /admin/tests, built asset headers
```

## 10. Results

| Check | Result |
| --- | --- |
| Client / worker / node typecheck | clean (0 errors) |
| ESLint | 0 errors, 6 warnings (all pre-existing `react-hooks/set-state-in-effect`, deliberate) |
| Unit tests | 7 files, **102 passed** (was 84; +18 import-validation) |
| Production build | `vite build` OK — 55 modules, 473 kB JS / 37 kB CSS (133 kB / 7.9 kB gzip) |
| Acceptance run | **86 checks passed, 0 failed** (`docs/acceptance-run.txt`) covering auth, content pipeline, classroom/assignment, student attempt + marking, full mock, structured import and teacher marking |
| Live worker | `/api/health` 200, `/` 200, `/admin/tests` 200, hashed assets served `immutable` |

## 11. Routes and screens to review manually

- `/` — landing page, hero, skill cards, teacher section, footer notice.
- `/login`, `/register`, `/join/:code` — public forms and notices.
- `/dashboard` — stat cards, deadlines, trends, estimated-band labelling.
- `/practice`, `/history`, `/history/:attemptId`, `/classrooms`, `/analytics`,
  `/profile`.
- `/exam/:attemptId` — Reading split panes, mobile tabs, navigator states,
  Listening audio panel, Writing tasks, full-mock progression, submit dialogs.
- `/teacher`, `/teacher/classrooms/:id`, `/teacher/assignments/:id`,
  `/teacher/students/:userId`.
- `/admin`, `/admin/tests`, `/admin/tests/:testId`, `/admin/imports`,
  `/admin/scoring-profiles`, `/admin/attempts`, `/admin/users`, `/admin/settings`
  (including the URL-based media panel).

Not done in this pass: candidate-visible Task 1 chart images (the V1 payload
exposes audio and passages only, so an image field would be a data-model change);
a Content-Security-Policy; and browser-automation tests — there is no browser in
this environment, so UI verification is typechecking, linting, code review
against recorded API shapes and live HTTP probes.
