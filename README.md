# Ai eo

A self-hosted practice platform for English exam preparation: reusable exam
shell, question engine, server-side marking, classrooms, assignments, analytics
and an AI-assisted content import pipeline.

It runs entirely on Cloudflare (Workers, D1, Queues) with a React 19 + Vite
single-page client served from the same Worker. **V1 needs no object storage:**
imports are processed in the request and kept in D1 as text, and listening audio
or diagram images are registered as external HTTPS URLs rather than uploaded.

> **Not affiliated with IELTS, the British Council, IDP or Cambridge.** All band
> figures produced by this platform are labelled **Estimated band** and come from
> conversion tables an administrator configures. The repository ships only
> original sample content.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Local development](#local-development)
- [Commands](#commands)
- [Sample data & demo accounts](#sample-data--demo-accounts)
- [Deployment](#deployment)
- [Security model](#security-model)
- [Testing](#testing)
- [Documentation](#documentation)

---

## Features

**Exam delivery**

- Reusable exam shell: server-authoritative countdown, section/component
  sequencing, autosave, resume after disconnect, and attempt recovery.
- Full mock exams built from configurable component sequences (skill order,
  per-component duration, breaks) — nothing is hard-coded to one test.
- Integrity monitor that records *observable* browser events (tab hidden,
  fullscreen exit, copy/paste, blur) with an explicit on-screen notice that
  these events are not proof of misconduct and cannot block OS-level actions
  such as Alt+Tab.

**Question engine**

- 15 registered types — True/False/Not Given, Yes/No/Not Given, MCQ single and
  multiple answer, matching (information, headings, features), sentence /
  summary / note / table / flowchart completion, short answer, and the two
  writing tasks.
- Reading split-panel layout with passage navigation; listening audio player
  with a configurable playback policy (max plays, preparation time, pause/seek).
- Visible division into sections: a section tab strip under the header (label,
  `answered/total`, completed tick, lock for parts that are not open yet and the
  per-section timer) and a sticky exam footer with the palette, **All questions**
  (the 1–40 question grid), the running score, one tab per section and
  Previous / Next — so a full mock never reads as one undivided list.
- Paper-style question layout: every group opens with an instruction banner
  (range, type and requirement), questions sit in one card with numbered rows,
  True/False/Not Given is a compact segmented control rather than three repeated
  option rows, and completion tasks draw the answer box inside the sentence at
  its `[[n]]` position.
- Answer keys, evidence and explanations are stored server-side only and never
  appear in a candidate payload. Released results render them: listening
  transcripts become speaker bubbles with timestamps, and every question gains a
  **Why these answers** panel with the evidence, the reasoning and, for
  listening, a *Listen from here* jump into the recording.
- Vocabulary notebook: candidates save words from passages, transcripts or
  explanation panels and revise them with search, inline edits and a self-test
  card (`/vocabulary`).

**Marking & results**

- Deterministic server-side marking with acceptable answer variants, word
  limits, partial credit for multiple-answer questions, and normalisation
  (case, whitespace, articles, numbers).
- Writing is **never** auto-scored: submissions are stored for a human reviewer
  to band and comment.
- Band estimation for reading/listening only, through versioned scoring
  profiles, refused for incomplete tests and always labelled as an estimate.
- Result visibility modes: immediate, after deadline, score only, or no review.

**Classes & analytics**

- Teacher classrooms with single-use, expiring, hashed invitations; students
  join with a code or an invite link.
- Assignments with deadlines, attempt limits, timing policy, exam mode,
  integrity overrides, and a per-student submission report.
- Teacher and student analytics: skill performance, trends, task-type accuracy,
  band distribution, integrity summaries.

**Administration**

- Dashboard, tests & versions, question bank editor, imports, scoring profiles,
  users, attempts, media URLs, audit log and platform settings.
- Media is registered, not uploaded: paste an HTTPS URL for listening audio or a
  chart image, and the candidate player follows an authorised redirect through
  `/api/files/:assetId`. A future version can add object storage behind the same
  resolver (`src/worker/services/media-service.ts`) without touching V1 code.
- Per-test access codes: an administrator can lock any test with a code (stored hashed, never plaintext). Students enter it once to unlock the test permanently; attempts and previews stay blocked until then, with guesses rate-limited. Assignment attempts bypass the code.
- Versioned content with a DRAFT → REVIEW → PUBLISHED → ARCHIVED lifecycle.
  Published versions are immutable and frozen; editing requires a new version.
- Deterministic validation before publish (blocking errors vs. warnings).
- Imports without object storage: **paste reading JSON or text**, or upload a
  document whose text is extracted during the request and stored in D1. Then
  validate → review → apply to a draft → publish. AI structuring is optional: if
  no API key is present, extraction and manual editing still work, and AI never
  publishes by itself.
- Structured reading JSON is validated before it can be published: answer fields
  leaked into student-visible content, duplicate/missing question numbers,
  malformed ranges, answer keys pointing at options that do not exist, invalid
  word limits, malformed evidence, duplicate paragraph labels or duplicated
  paragraph text, and an invented `passageWordCount`. Passage word counts are
  always recomputed from the text on the server, and a quoted piece of marking
  evidence must exist verbatim in the passage it refers to.

---

## Architecture

```
Browser  ──►  Cloudflare Worker (Hono)  ──►  D1   (users, content, attempts, results,
                    │                             extracted import text, media URLs)
                    │                   ──►  Queue(import pipeline jobs)
                    └──►  Static assets (React SPA bundle)
```

- One Worker serves both the API (`/api/*`, always handled first) and the SPA
  static assets, so there is no CORS surface and no second deployment.
- Shared TypeScript contracts (`src/shared`) are imported by both the Worker and
  the client; the answer-key and scoring modules are **worker-only**.
- The client is React 19 + react-router-dom 7 + TanStack Query, built with Vite.

```
src/
  shared/     types, question registry, validation, marking, scoring, integrity
  worker/     app, routes, services, middleware, extractors, AI client, lib
  client/     React SPA (pages, exam components, hooks, ui kit, styles)
migrations/   D1 schema (0001_init, 0002_imports_and_settings)
seed/         original sample content + wipe script
scripts/      database reset + end-to-end acceptance run
tests/unit/   vitest unit suite
docs/         delivery report, modernisation report and the recorded acceptance run
```

---

## Local development

Requirements: Node 20+ (developed on 22), npm, and a Cloudflare account only if
you intend to deploy.

```bash
npm install

# 1. Local secrets (git-ignored)
cp .env.example .dev.vars 2>/dev/null || true
#   SESSION_SECRET=<random string>   # required
#   OPENAI_API_KEY=<optional>        # enables AI structuring

# 2. Build the SPA and start the Worker (serves API + SPA on :8787)
npm run dev
```

`npm run dev` (and `npm run dev:api`) is a one-command start-up: it applies the
D1 migrations, loads `seed/seed.sql` when the local database has no tests yet,
starts the Worker and then provisions the demo accounts below and publishes the
sample tests. The local D1 file lives in `.wrangler/state`, which is not carried
between machines, containers or CI sandboxes — this is why a start-up that does
not migrate would otherwise greet you with *"The platform database is not
initialised yet"*.

Open <http://localhost:8787/> and sign in with a demo account, or register —
**the first account becomes the administrator** (the register form offers this
only while no administrator exists).

For a completely fresh local database (wipe, migrate, re-seed):
`npm run db:reset:local && npm run db:demo`.

For UI work with hot reload, run `npm run dev:client` (Vite on `:5173`, proxying
`/api` to the Worker on `:8787`).

`SESSION_SECRET` is required in production; in development the Worker falls back
to a clearly-marked local value so a fresh clone starts without configuration.

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build the client, prepare the local database, then run the Worker on `:8787` |
| `npm run dev:api` | Same start-up without rebuilding the client |
| `npm run dev:client` | Vite dev server with HMR, proxying `/api` |
| `npm run build` | Typecheck everything, then build the client |
| `npm run typecheck` | Worker, client and Node tsconfigs |
| `npm run lint` | ESLint (see the notes in `eslint.config.js`) |
| `npm test` | Unit test suite (vitest) |
| `npm run test:integration` | End-to-end acceptance run against a live Worker |
| `npm run db:migrate:local` / `:remote` | Apply D1 migrations |
| `npm run db:seed:local` / `:remote` | Load the original sample content |
| `npm run db:demo` | Create the demo accounts and publish the sample tests (needs a running Worker) |
| `npm run db:reset:local` | Wipe, migrate and re-seed the **local** database |
| `npm run deploy` | Build and deploy the Worker |

---

## Sample data & demo accounts

`seed/seed.sql` inserts two draft tests (a 13-question reading practice set and
a two-task writing set) plus two 40-question conversion tables. Nothing is
published in the SQL, so the publish workflow can be demonstrated end to end;
`npm run db:demo` (run automatically by `npm run dev`) then creates three demo
accounts and publishes both tests so the platform is immediately explorable:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@demo.test` | `Demo-Passw0rd!23` |
| Teacher | `teacher@demo.test` | `Demo-Passw0rd!23` |
| Student | `student@demo.test` | `Demo-Passw0rd!23` |

Override them with `DEMO_PASSWORD`, or point the script at another Worker with
`DEMO_BASE_URL`. The accounts are created through the public API, never by
writing passwords into the database.

`npm run test:integration` then creates its own accounts and content. A green
run leaves demo accounts in the local database (password
`Integration-Passw0rd!23`, suffix from the run id printed by the script):

| Role | Email pattern |
| --- | --- |
| Admin | `admin-<run>@example.test` |
| Teacher | `teacher-<run>@example.test` |
| Student | `student-<run>@example.test` |

The full acceptance run leaves a published 40-question reading test, a writing
test used as a mock component, a published two-component full mock, a classroom
with an assignment, submitted attempts, a marked writing submission and audit
log entries.

---

## Deployment

Full guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

**A deployed Worker is not a migrated database.** A live site that answers

```json
{"error":{"code":"STORAGE_UNAVAILABLE","message":"The platform database is not initialised yet, so accounts cannot be created or read."}}
```

is uploaded correctly and bound to a D1 database that has no tables yet. Fix it
with `npx wrangler d1 migrations apply DB --remote` and deploy again — or let
the bundled pipeline do both in the right order: copy
[`deploy/github-actions-deploy.yml`](deploy/github-actions-deploy.yml) to
`.github/workflows/deploy.yml` and it runs typecheck → lint → tests → remote
migrations → build → deploy → `/api/health` smoke test on every push to `main`.
Add `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, D1:Edit) and
`CLOUDFLARE_ACCOUNT_ID` as repository secrets to enable it. (The file ships
outside `.github/` because the GitHub App used by this workspace is not allowed
to push workflow files.)

The client **must be built before** `wrangler deploy` runs (the Worker serves
the SPA from `dist/client`). In the Cloudflare dashboard set:

| Setting         | Value                   |
| --------------- | ----------------------- |
| Build command   | `npm run build`         |
| Deploy command  | `npx wrangler deploy`   |

Or use the single command `npm run deploy` (build + deploy). Running
`npx wrangler deploy` without a build fails with
`assets.directory ... dist/client does not exist` — that error always means
the build step was skipped.

```bash
# One-off setup, then npm run deploy (see docs/DEPLOYMENT.md for details)
npx wrangler d1 create ielts-platform-db
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put SESSION_SECRET      # required
npx wrangler secret put OPENAI_API_KEY      # optional: enables AI structuring
npm run deploy
```

`APP_BASE_URL` in `wrangler.jsonc` must match the deployed origin: it is used
for the same-origin check, absolute links and cookie attributes.

---

## Security model

- **Authentication**: PBKDF2-SHA256 (210k iterations, per-user salt), no
  plaintext passwords anywhere. Sessions are server-side rows referenced by an
  HttpOnly, SameSite=Lax cookie; changing a password revokes existing sessions.
- **CSRF**: SameSite cookies + Origin/Referer validation + a per-session
  `X-CSRF-Token` header on every state-changing request.
- **Authorisation**: every route re-checks the role and the object relationship
  server-side (`requireClassroomAccess`, `requireStudentAccess`, admin guards).
  Hiding a button in the client is never the control.
- **Rate limiting**: fixed-window counters in D1 for registration, login (per
  address and per account), import uploads and the paid AI call.
- **Answer material**: keys, evidence and explanations live in a dedicated table
  and are never included in candidate-facing payloads; marking happens on the
  server with the frozen version snapshot.
- **Audit log**: administrative and security-relevant actions are recorded with
  actor, entity and metadata (no secrets, no passwords).
- **Headers**: the Worker sets baseline hardening headers on `/api/*`; the
  static bundle carries the same headers through `_headers` in `src/client/public`
  (verified in `wrangler dev`).

---

## Testing

```bash
npm run typecheck        # worker + client + node tsconfigs
npm run lint
npm test                 # 6 files / 84 unit tests
npm run build            # typecheck + production client build
npm run dev:api &        # then:
npm run test:integration # 71 end-to-end checks across 5 flows
```

Unit tests cover the marking engine, band conversion, deterministic validation,
integrity policy, the AI payload converter and the security helpers. The
acceptance run drives real HTTP sessions for the admin, teacher, student and
full-mock flows. The recorded output of a green run is in
[`docs/acceptance-run.txt`](docs/acceptance-run.txt).

---

## Documentation

- [`docs/UI-REFRESH.md`](docs/UI-REFRESH.md) — the light workspace pass: one
  visual language (white shell, icon set, product-first landing page), what it
  replaced, and how it was verified without a browser.
- [`docs/QUESTION-AUTHORING.md`](docs/QUESTION-AUTHORING.md) — how to create
  questions: the full structured-JSON import format, every supported question
  type, how answers/evidence/explanations are graded and shown, plus a
  pre-publish checklist and the common import errors.
- [`docs/MODERNISATION-REPORT.md`](docs/MODERNISATION-REPORT.md) — the visual
  modernisation and object-storage removal pass: tokens, components, pages,
  accessibility, remaining optional storage references and current bindings.
- [`docs/V1-REPORT.md`](docs/V1-REPORT.md) — architecture, data model, API map,
  bindings, deployment steps, executed tests, verified behaviour, limitations
  and the list of suggested future features that are intentionally *not*
  implemented.
