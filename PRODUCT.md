# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: a large number of Vietnamese-first learners preparing for IELTS**
  (confirmed: usage is high-volume — "a lot" — and Vietnamese-first is a binding
  constraint). They sit timed practice tests and full mocks in a browser, work
  the Learn path, and use the dictionary and vocabulary notebook between
  sessions. *(Confirmed by the owner 2026-10-21: the platform is **deployed and
  used by real users**, and the audience is exactly this mix — self-study
  learners **and** teacher-led classrooms on the same deployment.)*
- **Teachers** (roles `TEACHER`, confirmed in code): run classrooms, issue
  single-use invite codes, set assignments with deadlines and attempt limits,
  read skill/trend/integrity analytics, and their band always replaces an AI
  estimate.
- **Administrators** (`ADMIN`, confirmed in code): own content (tests, versions,
  question bank, imports), scoring profiles, users, attempts, media URLs, audit
  log and platform settings; the first account registered becomes the admin.

## Product Purpose

This record covers the **IELTS-UI exam platform** (`IELTS-UI/`, npm name
`ielts-platform`, product name **Ai eo**) — not the sibling projects in this
workspace.

A self-hosted practice platform for English exam preparation: a reusable exam
shell, a 15-type question engine, server-side marking, classrooms, assignments,
analytics, an AI-assisted content import pipeline, and a gamified Learn path —
all running on one Cloudflare deployment.

Success means: learners get honest, clearly labelled band estimates and steady,
measurable progress; teachers and admins can run exams and publish original
content without the platform ever claiming official authority. It is explicitly
**not affiliated with IELTS, the British Council, IDP or Cambridge.**

## Positioning

One platform where **everything is graded server-side and labelled as practice**:

- Answer keys, evidence and explanations never reach a candidate payload;
  marking runs on the server against a frozen version snapshot.
- Every band is an explicitly labelled estimate — *Estimated band* (full paper
  through a versioned scoring profile), *Projected band* (short set scaled up),
  *AI judges*, *Teacher* — never presented as an official result.
- Writing and Speaking are marked by **two independent AI judges shown only as
  Judge01 and Judge02** (model, vendor and endpoint never reach the browser);
  a teacher's band always wins, and Pronunciation is honestly reported as *not
  assessed*.
- Exam integrity **blocks and says so** rather than pretending: tab-lock
  strikes, a blocking overlay, automatic submission on the third strike, and a
  plain statement that a web page cannot police OS-level switching.
- Exams, Learn lessons, vocabulary and the two leaderboards all speak **one
  4.0–8.0 band ladder**, so progress means the same thing everywhere.
- Nothing is hard-coded to one test: reusable exam shell, component sequences,
  versioned content, configurable conversion tables — on a Cloudflare-only
  runtime with **no object storage**.

## Operating Context

- **Runtime:** Cloudflare only — one Hono Worker serves the REST API (`/api/*`
  first) and the built React 19 + Vite SPA from the same origin (no CORS
  surface); D1 for data, Queues optional for import jobs. Shared TypeScript
  contracts in `src/shared`; answer-key and scoring modules are worker-only by
  construction.
- **Local dev:** `npm run dev` (migrates D1, seeds sample content, provisions
  demo accounts, serves :8787); `npm run dev:client` for Vite HMR on :5173
  proxying `/api` — the path used for UI work.
- **Deployment:** `npm run deploy`, or the bundled GitHub Actions pipeline
  (typecheck → lint → tests → remote migrations → build → deploy → `/api/health`
  smoke test). Migrations must run before a new Worker serves traffic;
  `SESSION_SECRET` required in production; `APP_BASE_URL` must match the origin.
- **AI (optional):** Ollama keys (`OLLAMA_API_KEYS`, `OLLAMA_MODEL`,
  `OLLAMA_MODEL_2` for Judge01/Judge02; optional `OPENAI_API_KEY`). With no key,
  extraction and manual editing still work and AI never publishes by itself.
- **Media:** registered, not uploaded — external HTTPS URLs resolved through an
  authorised `/api/files/:assetId` redirect. V1 has no object storage.
- **Content workflow:** paste reading JSON/text or upload a document → validate
  → review → apply to a draft → publish, under a DRAFT → REVIEW → PUBLISHED →
  ARCHIVED lifecycle; published versions are immutable.
- **Language of use:** Vietnamese-first — learner-facing copy includes
  Vietnamese sentence renderings, glosses, dictionary meanings and judge
  summaries; the repo's own planning docs are written in Vietnamese.
- **Near-term roadmap context:** `IELTS-UI/docs/LEARN-EXPANSION-PLAN.md` is a
  Vietnamese draft spec (dated 2026-10-03) — recorded, not started, explicitly
  gated on the repo owner's permission; one decision in it (Q5) is unresolved.

## Capabilities and Constraints

**Confirmed functionality**

- Exam shell: server-authoritative countdown, section/component sequencing,
  autosave, resume after disconnect, attempt recovery, tab lock in every mode
  (three strikes auto-submit with answered work kept), full mocks from
  configurable component sequences with breaks.
- 15 registered question types (incl. True/False/Not Given, matching, the
  completion family, short answer, both writing tasks); reading split-panel
  with draggable divider; listening player with a configurable playback policy;
  paper-style instruction banners; section tab strip + sticky footer with
  palette, running score and question grid.
- Marking: deterministic server-side marking with acceptable variants, word
  limits, partial credit, normalisation; two AI judges for Writing/Speaking
  (consensus band to nearest half band, per-criterion bands, corrections,
  Vietnamese summary, notebook words); Reading/Listening never sent to AI;
  result visibility modes (immediate / after deadline / score only / no
  review).
- Learn path: lessons tagged in half bands on a 4.0–8.0 ladder stored in
  `learn_lessons` (seeded, no lesson text in the browser bundle), hearts, XP,
  stars, daily goal, coins, streak, quests, shop (hint, heart refill, double
  XP, streak freeze), two leaderboards, mascot **Bơ** (original SVG, seven
  moods), 25 synthesised sound effects, tap-to-look-up, cached sentence
  translation, Leitner spaced review of a saved vocabulary notebook.
- Classes & analytics: hashed single-use expiring invites, assignments with
  deadlines/attempt limits/timing/exam mode/integrity overrides, per-student
  submission reports, skill/trend/task-type/band-distribution analytics.
- Admin: tests & versions, question-bank editor, imports (AI structuring
  optional), scoring profiles, users, attempts, media URLs, audit log,
  settings; per-test hashed access codes with rate-limited guesses; blocking
  publish validation (incl. answer leakage detection and verbatim evidence
  checks).
- Security (confirmed): PBKDF2-SHA256 (210k), server-side sessions with
  HttpOnly SameSite=Lax cookie, CSRF (origin + per-session token), per-route
  server-side authorisation, D1 fixed-window rate limits, audit log, hardened
  headers.

**Constraints**

- Cloudflare-only runtime; no object storage in V1 (a later pass removed the R2
  dependency entirely).
- Original sample content only; no official-exam logos, wordmarks or material;
  no affiliation claim (enforced by `tests/unit/brand.test.ts`).
- Exam monitoring records observable browser events only — never asserted as
  proof of cheating; no camera/microphone proctoring, ever out of scope.
- Known gaps, deliberately present: no CSP yet (needs nonce/hash pipeline), no
  outbound email, no OCR, D1-counter rate limiting (swap point identified),
  analytics computed on demand (no materialised rollups), no browser-level DOM
  tests.
- Confirmed by the owner 2026-10-21: deployed with real users; primary audience
  is Vietnamese self-study learners plus teacher-led classrooms.
- Explicitly undecided: deployment shape and capacity at scale (no figures
  recorded); Learn-expansion storage conflict in the draft plan (Q5, "chưa
  chốt"). Features in V1-REPORT §15 are *not commitments* — treat as absent
  unless reconfirmed. Note: V1-REPORT §14/§15 predates the AI judges, speaking
  marking and Learn gamification, all of which now ship per README.

## Brand Commitments

- Name: **Ai eo** — five standalone SVG brand assets ship at
  `IELTS-UI/src/client/public/brand/aieo-*.svg` (horizontal light/dark, icon
  light/dark + one more), asserted by `IELTS-UI/tests/unit/brand.test.ts`.
- Mascot: **Bơ**, an original SVG creature with seven moods, existed at
  `src/client/components/learn/Mascot.tsx` and was **removed by owner order
  (round of 2026-10-21, committed in 7f503de)** — no mascots ship in the UI
  today; the component and every render site were deleted.
- Voice: honest about estimates, never authoritative-sounding; labels every
  band; says plainly what integrity features can and cannot do; shows judges as
  Judge01/Judge02 only.
- Vietnamese-first (confirmed binding): Vietnamese glosses, summaries and
  translations are product facts, not nice-to-haves.
- Binding constraints from the repo: original content only, no official-exam
  branding, no fabricated testimonials/customers/pricing anywhere in the
  product.
- Binding look (owner decision, 2026-10-22): the **Character Goods Catalog**
  pin of 2026-10-21 (which itself had revoked the earlier "computer-delivered
  IELTS screen" pin) was **revoked by the owner** the same day and replaced by
  the **Catppuccin** visual world — Latte flavour ground for the app with a
  mauve commitment (`#8839ef` primary, slate-blue ink scale, pastel
  mauve/green/blue/gold cell tints), Mocha (`#1e1e2e`) for dark bands and the
  call room, **Be Vietnam Pro** across the scale as display + body,
  pill buttons, rounded cards, soft shadows, no glass/glow/emoji. Recorded in
  `DESIGN.md`. Still binding from the earlier pins: one original SVG icon set,
  no emoji, no fabricated claims; self-hosted woff2 only, Vietnamese subsets
  mandatory (Be Vietnam Pro ships vietnamese/latin/latin-ext from @fontsource).
  Vietnamese-first and every-band-labelled remain invariants. The call room
  keeps English chrome (room strings stay EN by product decision).

## Evidence on Hand

- `IELTS-UI/README.md` — the fullest feature/contract record.
- `IELTS-UI/docs/` — `V1-REPORT.md` (architecture, design constraints,
  limitations; §14/§15 partly stale), `UI-REFRESH.md`,
  `QUESTION-AUTHORING.md`, `MODERNISATION-REPORT.md`, `LEARN-GAMIFICATION.md`,
  `LEARN-EXPANSION-PLAN.md` (draft, Vietnamese), `DEPLOYMENT.md`,
  `acceptance-run.txt` (recorded green acceptance run).
- `IELTS-UI/seed/seed.sql` — original sample tests + conversion tables; demo
  accounts documented in README (`admin@demo.test` / `teacher@demo.test` /
  `student@demo.test`, `Demo-Passw0rd!23`).
- Brand assets above; `Mascot.tsx`; 25-effect `sfx.ts`; 19 D1 migrations;
  `IELTS-UI/tests/unit/` suite (marking, bands, judges, Learn, integrity,
  security, brand) + `scripts/integration.mjs` acceptance run.
- **Absences future work must not fabricate:** no DESIGN.md (documented design
  lives in `docs/UI-REFRESH.md` and CSS); no testimonials, press, case studies,
  customer logos, pricing or licensing claims; no official IELTS material (by
  rule); no browser-level DOM test evidence; no provisioned remote-infra or
  live-deployment metrics in the repo (usage scale comes only from the user's
  "a lot").

## Product Principles

1. **Honest estimates, never official results.** Every band is labelled;
   affiliation is disclaimed; integrity events are observations, not
   accusations.
2. **The server is the source of truth.** Keys and scoring never reach the
   browser; hiding a button is never the control.
3. **One reusable engine, versioned original content.** Nothing hard-coded to
   one test; published versions immutable; validation blocks leaks before
   publish.
4. **AI assists, never decides alone.** Two independent anonymised judges, a
   teacher band always wins, graceful manual fallback with no key, and AI never
   publishes content by itself.
5. **Learn and test share one ladder.** Exams, lessons, vocabulary and
   leaderboards speak the same 4.0–8.0 band, so progress means one thing.

## Accessibility & Inclusion

- Vietnamese-first is the inclusion baseline: diacritics, glosses and
  translations must render correctly everywhere (a Vietnamese-supporting font is
  bundled).
- Motion and sound already respect `prefers-reduced-motion` (all synthesised
  effects, confetti and floating numbers switch off).
- No formal accessibility standard target (e.g. WCAG level) has been set —
  recorded as open, not invented. Known verification gap: no browser-level DOM
  tests, so keyboard/screen-reader behaviour is reviewed, not machine-verified.
