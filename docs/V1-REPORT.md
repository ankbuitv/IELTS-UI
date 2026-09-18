# V1 Final Report — IELTS-Style Practice Platform

**Repository:** `ielts-ui` (this checkout)
**Branch:** `arena/01a0b3be-ielts-ui` (session branch — the previously requested
`feature/ielts-platform-v1` name could not be created because this session is
pinned to the branch above; nothing was merged into `main`)
**Status:** V1 complete and verified end to end against a running Worker
**Acceptance:** `71/71` checks pass across the four required flows
(ADMIN, TEACHER, STUDENT, FULL MOCK) — recorded in
[`docs/acceptance-run.txt`](acceptance-run.txt)

---

## 1. Executive summary

The repository started as a single `README.md`. It now contains a complete,
deployable platform on Cloudflare:

| Area | Delivered |
| --- | --- |
| Runtime | One Worker (Hono) serving the REST API and the built React SPA |
| Data | D1 schema, 30 tables, two migrations, versioned content |
| Storage | R2 for import sources, audio and images; queue for import jobs |
| Client | React 19 + react-router-dom 7 SPA, 24 routed pages, responsive original UI |
| Roles | STUDENT, TEACHER, ADMIN with server-side authorisation everywhere |
| Exam shell | Server-authoritative timer, autosave, resume, full-mock sequencing |
| Question engine | 15 registered types, 7 input controls, server-only answer keys |
| Marking | Deterministic server-side marking, manual writing review, estimated bands |
| Content | Draft/Review/Published/Archived versions, deterministic validation |
| Imports | Upload → extract → AI structure → validate → review → publish (never auto-publish) |
| Classes | Classrooms, invites, assignments, deadlines, attempt limits, analytics |
| Security | RBAC, IDOR protection, CSRF, rate limiting, audit log, hardened headers |
| Quality | 3 tsconfigs clean, ESLint 0 errors / 6 deliberate warnings, 84 unit tests, production build, 71 acceptance checks |

Two verification passes were run against the live Worker: an endpoint/shape
probe sweep for all three roles, and the acceptance script. Both are described in
§11 with their actual output.

---

## 2. Repository assessment (pre-implementation report, delivered here for the record)

**What existed.** A single `README.md` (one line of content). No source, no
schema, no tooling. A repository-wide file listing confirmed nothing to preserve
beyond the repository itself, so no destructive change was needed.

**Constraints that shaped the design.**

- Cloudflare-only runtime (Workers + D1 + R2 + Queues).
- Original branding and content only; no IELTS/British Council/IDP/Cambridge
  logos, wordmarks or official material; no claim of official affiliation.
- Answer keys must never reach a candidate client and no score may be trusted
  from the browser.
- No AI writing scores in V1; AI import must degrade gracefully without an API key.
- Exam monitoring may only record *observable browser events*; a web page cannot
  block OS shortcuts and must not present events as proof of cheating.
- Teachers must not reach unrelated students or classrooms by editing ids.
- Band figures are estimates produced from administrator-defined conversion
  tables, never presented as official results.

**Proposed architecture (as implemented).** A single Worker owns every API route
and serves the SPA assets, which removes CORS entirely and keeps the security
boundary in one place. Shared TypeScript contracts live in `src/shared` and are
imported by both sides; the modules that contain answer material or grading
logic are worker-only by construction (`answer-key.ts`, `scoring.ts` are never
imported from `src/client`). D1 holds relational state; R2 holds binaries and is
referenced by `assets` rows; a queue carries the expensive import stages so a
request never blocks on extraction or AI.

**Phases.** (1) schema + shared contracts, (2) worker services and routes,
(3) client foundation and exam shell, (4) student/teacher/admin areas,
(5) hardening, tests and deployment configuration. All five phases are complete;
the sections below describe the delivered state rather than the plan.

---

## 3. Architecture

```
Browser ─┬─ SPA (React 19, Vite 8)  ──┐
         │                            ├─► Worker (Hono) ─► D1 / R2 / Queue
         └─ /api/* (same origin)   ────┘
```

- `wrangler.jsonc` sets `run_worker_first: ["/api/*"]`; every API request passes
  through the Worker's middleware, while HTML/CSS/JS come from the assets binding
  for speed. The static bundle therefore carries its own hardening headers via
  `src/client/public/_headers` (§10).
- The SPA uses hash-free routing; unknown paths fall back to `index.html`
  (`not_found_handling: single-page-application`), while unknown `/api/*` paths
  return a JSON 404.
- `APP_BASE_URL` and `SESSION_*` are plain vars; `SESSION_SECRET` and
  `OPENAI_API_KEY` are Worker secrets, read only server-side.

**Source layout**

| Path | Contents |
| --- | --- |
| `src/shared/` | `types.ts`, `question-types.ts`, `answer-key.ts` (worker-only), `scoring.ts` (worker-only), `validation.ts`, `integrity.ts`, `candidate.ts` |
| `src/worker/routes/` | `auth`, `catalog`, `attempts`, `student`, `classrooms`, `teacher`, `admin`, `imports`, `files` |
| `src/worker/services/` | `auth`, `content`, `content-write`, `attempt`, `marking`, `teacher`, `analytics`, `import` |
| `src/worker/lib/` | `crypto`, `http`, `rate-limit`, `settings`, `audit`, `errors`, `ids`, `validate`, `auth-types` |
| `src/worker/extract/`, `src/worker/ai/` | PDF/DOCX/text extraction, OpenAI structuring client |
| `src/client/` | `pages/` (public, student, exam, teacher, admin), `components/exam`, `components/ui`, `components/charts`, `context`, `hooks`, `lib`, `styles` |
| `migrations/`, `seed/`, `scripts/`, `tests/unit/`, `docs/` | schema, sample data, tooling, tests, this report |

Sizes: 72 TypeScript files / ~21.5k lines in `src`, 886 lines of unit tests,
1681 lines of SQL and tooling scripts.

---

## 4. Data model

Two migrations create 30 tables.

**Identity & security** — `users`, `user_profiles`, `sessions`,
`rate_limit_counters`, `login_attempts`.
**Classes** — `classrooms`, `classroom_members`, `classroom_invites`.
**Content** — `assets`, `tests`, `test_versions`, `passages`, `sections`,
`question_groups`, `questions`, `answer_keys`, `scoring_profiles`,
`score_conversion_ranges`, `mock_components`.
**Delivery** — `assignments`, `attempts`, `attempt_skill_sessions`,
`attempt_answers`, `integrity_events`, `writing_submissions`, `writing_scores`.
**Imports** — `imports`, `import_jobs`, `import_drafts`.
**Operations** — `admin_audit_logs`, `platform_settings`.

Design decisions worth noting:

- `answer_keys` is a separate table referenced by `question_id`; it is never
  joined into a candidate payload.
- `tests` carries content-provenance columns (`content_origin`, `source_title`,
  `source_url`, `attribution`, `license_notes`) so licensing stays visible.
- `test_versions` is the unit of delivery: assignments and attempts reference a
  version, published versions are immutable, and `frozen_snapshot_json` keeps
  the canonical content (including keys) at publish time.
- `attempt_skill_sessions` drives the exam shell: each skill/component gets a
  row with its own start, deadline and status, which is what makes full-mock
  sequencing and per-section timing possible without hard-coding.
- Queries favour set-based work: the attempt page loads one row set per table
  and assembles in memory; analytics use grouped aggregate queries instead of
  per-row lookups, and heavy admin list pages use correlated sub-selects only
  where an index exists.

---

## 5. Route map (client)

| Area | Paths |
| --- | --- |
| Public | `/`, `/login`, `/register`, `/join` |
| Student | `/dashboard`, `/practice`, `/history`, `/attempts/:attemptId`, `/analytics`, `/classrooms`, `/profile` |
| Exam | `/exam/:attemptId` (full-screen shell, excluded from the app chrome) |
| Teacher | `/teacher`, `/teacher/classrooms/:classroomId`, `/teacher/assignments/:assignmentId`, `/teacher/students/:userId` |
| Admin | `/admin`, `/admin/tests`, `/admin/tests/:testId`, `/admin/imports`, `/admin/scoring-profiles`, `/admin/users`, `/admin/attempts`, `/admin/settings` |
| Fallback | `*` → not found |

Guarded routes redirect unauthenticated users to `/login` and role-mismatched
users to their own home area; each guarded page also tolerates a server 401/403
by surfacing an error notice rather than rendering partial data.

---

## 6. API map

All endpoints are JSON, same-origin, and re-authorise on the server.

**Auth** — `GET /api/auth/status`, `POST /api/auth/register`, `POST /api/auth/login`,
`POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/auth/profile`,
`POST /api/auth/password`.

**Catalogue & files** — `GET /api/tests`, `GET /api/tests/:testId/preview`,
`GET /api/files/:assetId` (visibility-checked R2 delivery).

**Attempts** — `POST /api/attempts`, `GET /api/attempts/:id`,
`PATCH /api/attempts/:id/answers`, `POST /api/attempts/:id/writing`,
`POST /api/attempts/:id/integrity`, `POST /api/attempts/:id/advance`,
`POST /api/attempts/:id/submit`, `GET /api/attempts/:id/result`.

**Student** — `GET /api/student/dashboard`, `GET /api/student/attempts`,
`GET /api/student/assignments`, `GET /api/student/analytics`.

**Classrooms** — `POST /api/classrooms/join`, `GET /api/classrooms/mine`.

**Teacher** — `GET|POST /api/teacher/classrooms`,
`GET|PATCH /api/teacher/classrooms/:id`, `POST /api/teacher/classrooms/:id/archive`,
`GET /api/teacher/classrooms/:id/members`, `POST /api/teacher/classrooms/:id/members`,
`DELETE /api/teacher/classrooms/:id/members/:userId`,
`POST /api/teacher/classrooms/:id/invites`,
`DELETE /api/teacher/classrooms/:id/invites/:inviteId`,
`POST /api/teacher/invites/accept`, `POST /api/teacher/assignments`,
`GET|PATCH|DELETE /api/teacher/assignments/:id`,
`GET /api/teacher/students/:userId`, `GET /api/teacher/attempts/:attemptId`,
`GET /api/teacher/classrooms/:id/students`,
`GET /api/teacher/classrooms/:id/analytics`.

**Admin** — `GET /api/admin/dashboard`; users `GET|POST /api/admin/users`,
`PATCH /api/admin/users/:id`; content `GET|POST /api/admin/tests`,
`GET|PATCH|DELETE /api/admin/tests/:testId`, `POST /api/admin/tests/:testId/archive`,
`GET /api/admin/versions/:versionId`, `POST /api/admin/tests/:testId/versions`,
`PUT /api/admin/versions/:versionId/content`,
`POST /api/admin/versions/:versionId/validate|publish|unpublish|clone`,
`GET /api/admin/versions/:versionId/preview`; scoring
`GET /api/admin/scoring-profiles`, `GET /api/admin/scoring-profiles/:id`,
`POST /api/admin/scoring-profiles`, `POST /api/admin/scoring-profiles/:id/status`;
attempts `GET /api/admin/attempts`, `GET /api/admin/attempts/:attemptId`,
`POST /api/admin/writing-scores`; platform `GET|PATCH /api/admin/settings`,
`GET /api/admin/audit-logs`; assets `GET|POST /api/admin/assets`,
`PATCH|DELETE /api/admin/assets/:id`.

**Imports** — `GET|POST /api/admin/imports`, `GET /api/admin/imports/:id`,
`GET /api/admin/imports/:id/extracted`, `POST /api/admin/imports/:id/process`,
`PATCH /api/admin/imports/:id`, `POST /api/admin/imports/:id/apply`,
`POST /api/admin/imports/:id/discard`.

**Health** — `GET /api/health`.

---

## 7. Authentication and authorisation

- **Passwords**: PBKDF2-SHA256, 210,000 iterations, per-user random salt,
  constant-time comparison; stored as algorithm + iterations + hash, never
  plaintext. A dummy PBKDF2 verification runs for unknown e-mails so response
  timing does not reveal account existence.
- **Sessions**: random 256-bit token stored hashed (with a pepper from
  `SESSION_SECRET`); the cookie is `HttpOnly`, `SameSite=Lax`, `Secure` outside
  development. Sessions expire (`SESSION_TTL_HOURS`, default 12) and are revoked
  on password change.
- **Lockout**: 8 failed logins lock the account for 15 minutes, on top of the
  rate limits below.
- **CSRF**: state-changing requests require a matching `X-CSRF-Token`, and the
  Origin/Referer must be the platform's own origin (the check derives the
  request's own origin as well as `APP_BASE_URL`, so it stays correct behind
  proxies and on preview hostnames). Foreign origins are rejected with 403 —
  verified live, including from the acceptance script.
- **Rate limiting**: registration 20/15 min per address; login 10/15 min per
  address and 12/15 min per account (configurable); import upload 60/h per user;
  the paid AI structuring call 30/h per user. Verified live: repeated bad logins
  returned `429` after the window budget was spent.
- **Authorisation helpers**: `requireClassroomAccess` (owner, co-teacher or
  admin), `requireStudentAccess` (shared classroom, self, or admin), admin
  guards on every `/api/admin/*` route, and per-object checks on files.
- **Audit log**: role changes, bootstrap, publishing, imports, writes and forced
  submissions are recorded with actor, entity, metadata and IP. Passwords and
  tokens are never written.

---

## 8. Exam delivery

**Server-authoritative timing.** The client never decides how much time is left:
it stores a clock offset from `GET /api/attempts/:id` and recomputes remaining
time from ISO deadlines on every server response. `enforceTime` runs on the
server, closes expired sections, and auto-submits an attempt as `TIMEOUT`.
A 60-second transition grace exists so a candidate cannot lose a section to a
slow request.

**Autosave and recovery.** Answers are batched to
`PATCH /api/attempts/:id/answers` (30 answers in one request in the acceptance run),
keyed by the ids the server issued. Writing goes through a separate endpoint and
is excluded from autosave. An in-progress attempt can be resumed; the dashboard
and `/history` surface unfinished attempts for recovery.

**Full mock.** `mock_components` defines the sequence: skill, source version,
duration, and the break that follows. `POST /api/attempts/:id/advance` closes the
current component and opens the next, creating its skill session row; the
attempt is only submitted when every component is done. The acceptance run
verifies a reading → writing sequence with a break and a mid-mock transition.

**Integrity monitor.** Policies come from the exam mode plus optional per
assignment overrides (`sanitiseIntegrityOverrides` clamps numbers to 0–100,
accepts booleans, and only allows `null` for the four threshold keys). Recorded
events are observable browser signals: visibility change, fullscreen exit,
copy/paste, context-menu and blur. Counted events are tab-away and fullscreen
exit; warning and auto-submit thresholds are configurable per assignment. The
candidate sees a notice (configurable in platform settings) stating plainly that
a page cannot block OS-level shortcuts and that these events are not proof of
misconduct. Students cannot self-select a monitoring mode for practice runs —
verified in the acceptance run.

---

## 9. Marking, bands and result visibility

- **Objective marking** is deterministic and server-side: acceptable variants,
  normalisation (case, whitespace, leading articles, numeric forms), word limits
  from `config.wordLimit` or the group instructions, partial credit for
  multiple-answer questions with no over-award for duplicate picks, and manual
  keys that are never auto-correct.
- **Writing** is stored for human review. Teachers/admins band it through
  `POST /api/admin/writing-scores`; the score records its source (`ADMIN`) and
  appears in results, reports and analytics. No AI score is produced in V1.
- **Estimated bands** apply to reading/listening only, require an active scoring
  profile for the right skill, require a complete test (`is_complete_test` and
  the profile's `min_questions`), and are refused for incomplete practice sets —
  the raw score is shown instead. Every band display carries the label
  *"Estimated band — a practice indication from a configured conversion table,
  not an official IELTS result and not affiliated with IELTS, the British
  Council, IDP or Cambridge."*
- **Visibility modes** (`IMMEDIATE`, `AFTER_DEADLINE`, `SCORE_ONLY`,
  `NO_REVIEW`) are resolved per attempt on the server; the result payload tells
  the client what it may show and the review payload is withheld when the policy
  says so.

---

## 10. Security posture and headers

- Candidate payloads contain no `answerKey`, `evidence` or `explanation` — the
  acceptance run asserts this on the candidate attempt state, on the admin
  preview payload, and via a canary string planted in server-only evidence.
- Files are delivered through `/api/files/:id` after a visibility check; R2 keys
  are not exposed.
- Uploads validate MIME type and size (26,214,400 bytes) and store a SHA-256
  checksum.
- The Worker sets `x-content-type-options`, `referrer-policy`,
  `x-frame-options`, `permissions-policy` and a request id on `/api/*`.
  Because HTML/CSS/JS are served by the assets binding (which bypasses the
  Worker), the same headers, plus long-lived caching for hashed assets and
  `no-cache` for `index.html`, are declared in `src/client/public/_headers`.
  This was verified in `wrangler dev`: the document, a deep SPA route and a
  hashed JS asset all return the four headers, the asset returns
  `cache-control: public, max-age=31536000, immutable`, and `_headers` itself is
  not served as a file.
- Content-Security-Policy is deliberately **not** enabled yet: the SPA has no
  inline scripts, but a correct policy needs a nonce/hash pipeline and a review
  of every asset loader. It is listed in §14.

---

## 11. Tests actually executed

Commands were run in this repository; results below are the observed output, not
expectations.

**Type checking** — `npm run typecheck`:

```
tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.client.json --noEmit
  && tsc -p tsconfig.node.json --noEmit      →  exit 0, no diagnostics
```

**Linting** — `npx eslint .` → **0 errors, 6 warnings** (exit 0). The six
warnings are the deliberate `react-hooks/set-state-in-effect` cases documented in
`eslint.config.js` (data fetching on mount and editor-state resets); they are
kept visible for a future React Compiler migration rather than silenced.

**Unit tests** — `npx vitest run tests/unit` → **6 files, 84 tests passed**:

| File | Tests | Focus |
| --- | --- | --- |
| `answer-key.test.ts` | 15 | grading, variants, word limits, partial credit, manual keys |
| `scoring.test.ts` | 16 | band conversion, refusals, disclaimer wording |
| `validation.test.ts` | 13 | publish gate, blocking errors vs warnings |
| `integrity.test.ts` | 9 | event classification, counted-event policy |
| `import-conversion.test.ts` | 11 | AI payload conversion, override sanitising |
| `security.test.ts` | 20 | PBKDF2, tokens, hashing, id/helpers |

**Production build** — `npx vite build` → 55 modules, `index.html` 0.69 kB,
CSS 19.79 kB (gzip 4.83), JS 457.67 kB (gzip 129.27), built in ~0.3 s.

**End-to-end acceptance** — `npm run test:integration` against a running Worker
(`npx wrangler dev --port 8787`) →

```
71 checks passed, 0 failed.
```

Full recorded output: [`docs/acceptance-run.txt`](acceptance-run.txt). The five
flows it exercises:

1. **ADMIN** — scoring profile creation, test creation, 40-question content save,
   deterministic validation, publish, refusal to re-publish, immutability of
   published content, catalogue visibility, preview leakage checks, writing
   version published for use as a mock component.
2. **TEACHER** — classroom creation, single-use invite minting, enrolment,
   member listing, and an IDOR check confirming another teacher receives 403/404
   for the same classroom id.
3. **STUDENT** — dashboard, attempt start, 40 questions visible, answer-key
   absence, authoritative server time, batch autosave, integrity events counted,
   submission, rejection of post-submission edits, server-marked raw score of
   30/40, estimated band 7.0 through the seeded profile, immediate release, the
   "estimated" label, attempt-limit refusal on the third attempt, attempt
   history, and refusal of a self-selected exam mode.
4. **FULL MOCK** — two-component version saved and published, sequence order
   honoured, break handling, integrity notice driven by settings, answers saved
   against the first component, `advance` switching to the writing component
   without submitting, writing saved with a server word count, final submission,
   and a result containing both skill sessions with the writing submission left
   unmarked.
5. **TEACHER/ADMIN marking** — writing submission id exposed, human band saved,
   band and source reflected on the attempt, audit entries for
   `WRITING_SCORE_SET` and `VERSION_PUBLISH`, no password in the audit log,
   settings readable and updatable, teacher report and classroom analytics
   reflecting the attempts.

**Live role probes** (cookie-jar scripts run against the same Worker) confirmed
status codes and payload shapes for every list/detail endpoint used by the
client:

- Admin: `auth/me`, `admin/dashboard`, `admin/users`, `admin/settings`,
  `admin/assets`, `admin/audit-logs`, `admin/imports`, `admin/attempts`,
  `admin/tests`, `admin/scoring-profiles`, `tests` — all `200`, all matching the
  shapes declared in `AdminDashboard.tsx`, `AdminUsers.tsx`, `AdminTests.tsx`,
  `content-types.ts` and `AdminTestEditor.tsx`.
- `GET /api/admin/versions/:id` returns
  `{test, version, sections, assets, mockComponents, attemptCount, editable}`
  with the content tree at the top level, matching
  `AdminVersionContentResponse`. (An intermediate probe read a non-existent
  `content` sub-key; the client type and `loadAdminVersion` confirmed the
  correct shape.)
- Teacher: classroom list/detail, student list, classroom analytics, student
  detail — all `200`. This pass found and fixed a real defect: student detail
  returned the raw D1 envelope for `classrooms` instead of the rows, which broke
  the student view in the client. It now returns `classrooms.results` (verified
  live: `classrooms[0] => id,name`), and an unused duplicate interface was
  removed from the service layer.
- Student: dashboard, attempt history, classrooms, catalogue, attempt state and
  result — all `200`, with the result payload containing `release`, per-session
  `band/bandAvailable/bandMessage`, and the integrity summary.

**Judgement calls made while testing (recorded for honesty)**

- `wordLimit` caps were raised from 50 to 2000: a writing task's minimum word
  count is legitimately 250, so the original cap made valid writing content
  unsaveable. Found by the acceptance run, fixed in the admin and import
  schemas, then re-verified.
- The acceptance fixture initially placed its canary string in candidate-visible
  passage prose; it now lives in server-only evidence, so the leak assertions
  test the real boundary.
- No browser automation is available in this environment (no Chromium, no
  Playwright/Puppeteer/jsdom). UI verification therefore consists of type
  checking, linting, code review against recorded API shapes, and the live
  probes above. Interaction-level browser tests remain a gap (§14).

---

## 12. Cloudflare bindings, secrets and deployment

| Binding | Type | Name | Status |
| --- | --- | --- | --- |
| `DB` | D1 | `ielts-platform-db` | local database migrated and seeded; **remote id is a placeholder** (`REPLACE_WITH_D1_DATABASE_ID`) |
| `CONTENT_BUCKET` | R2 | `ielts-platform-content` | configured; bucket must be created in the target account |
| `IMPORT_QUEUE` | Queue producer | `ielts-import-jobs` | configured; degrade-to-inline when absent locally |
| `ielts-import-jobs` | Queue consumer | — | configured (batch, retries, DLQ) |
| `ielts-import-jobs-dlq` | Dead-letter queue | — | configured |
| `ASSETS` | Static assets | `dist/client` | built and served |
| Cron | `*/30 * * * *` | housekeeping: prune rate-limit counters, expired sessions and login attempts | configured |

| Variable | Where | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | **secret** | token pepper / session hashing — required in production |
| `OPENAI_API_KEY` | **secret** (optional) | AI structuring; absent → imports stay manual |
| `APP_ENV`, `APP_BASE_URL`, `SESSION_TTL_HOURS`, `SESSION_COOKIE_NAME`, `OPENAI_MODEL`, `LOGIN_RATE_LIMIT_PER_15MIN`, `AI_RATE_LIMIT_PER_HOUR` | vars | runtime configuration |

**Deployment steps for the operator** (these require account permissions and
were therefore **not** executed here):

1. `npx wrangler d1 create ielts-platform-db` and copy the id into
   `wrangler.jsonc`.
2. `npx wrangler r2 bucket create ielts-platform-content`.
3. `npx wrangler queues create ielts-import-jobs` and `...-dlq`.
4. `npx wrangler d1 migrations apply DB --remote` (optionally followed by
   `npx wrangler d1 execute DB --remote --file=./seed/seed.sql`).
5. `npx wrangler secret put SESSION_SECRET` (and `OPENAI_API_KEY` if AI imports
   are wanted).
6. Confirm `APP_BASE_URL` matches the deployed origin, then `npm run deploy`.
7. Custom domain: `wrangler.jsonc` declares `custom_domain: ielts.ankb.qzz.io`.
   This only works if that hostname's zone is in the deploying account; if it is
   not, remove the block and add the hostname in the Cloudflare dashboard
   instead. **No DNS or custom-domain configuration was performed or verified in
   this environment** — it needs account access that is not available here.
8. Register the first account in the deployed instance to bootstrap the
   administrator (then optionally disable self-service registration in
   Settings).

---

## 13. Verified local state

- Worker running via `npx wrangler dev --port 8787 --ip 0.0.0.0`, D1 migrated
  and seeded.
- `GET /api/auth/status` → `200` with `{adminConfigured, aiImportAvailable,
  registrationEnabled, environment, integrityNotice}`; `/` and `/admin/tests`
  return the SPA document with hardening headers.
- A green acceptance run leaves these demo accounts (password
  `Integration-Passw0rd!23`): `admin-mu6rpnxa@example.test`,
  `teacher-mu6rpnxa@example.test`, `student-mu6rpnxa@example.test`,
  `intruder-mu6rpnxa@example.test` (the run-id suffix changes with every run).
- Seeded content: two draft tests (13-question reading practice, two-task
  writing practice) and two 40-question conversion tables — all original text
  written for this repository.

---

## 14. Limitations and known gaps

1. **Browser-level UI tests are absent.** No headless browser is available in
   this environment, so interaction behaviour (drag-free question widgets, audio
   playback controls, modal flows) is verified by code review and API-shape
   checks, not by automated DOM tests.
2. **Rate limiting uses D1 counters.** Correct, but a distributed limiter
   (Cloudflare Rate Limiting rules or Durable Objects) would be more appropriate
   at scale; the call sites are isolated, so swapping it is contained.
3. **AI import depends on an external provider.** With no key, structuring is
   skipped (status `SKIPPED`, import moves to `REVIEW`) and manual editing
   remains available — but the extraction quality for scanned PDFs relies on
   whatever text the source contains; there is no OCR.
4. **Writing is marked by humans only.** Intentional for V1; there is no AI
   writing score anywhere in the codebase.
5. **Estimated bands are practice indications.** They come from administrator
   conversion tables, refuse incomplete tests, and are never presented as
   official results.
6. **Integrity monitoring is observational.** It records what a web page can
   observe; it cannot detect a second device, cannot block OS shortcuts, and
   never asserts misconduct.
7. **Content-Security-Policy is not enabled** (see §10) — a nonce/hash pipeline
   plus an asset-loader review is needed first.
8. **Email is not sent.** Invitations can be copied as links or applied by
   e-mail address; there is no outbound mail provider.
9. **Remote infrastructure was not provisioned** (D1 id, R2 bucket, queues,
   custom domain, secrets). Steps are documented in §12; they need account
   permissions.
10. **Local databases accumulate runs.** Without `npm run db:reset:local`, a
    second acceptance run stops at "an administrator already exists" — by
    design, since the script refuses to hijack an existing platform.
11. **`custom_domain` in `wrangler.jsonc` may need adjustment** depending on
    which account owns `ankb.qzz.io`.
12. **Analytics are computed on demand.** Queries are aggregate-based, but there
    is no materialised cache yet; noted as a scaling follow-up.

---

## 15. Suggested Future Features — Not Implemented

The following were considered and deliberately **not** built in V1. None of them
is present in the codebase, and none should be treated as available.

- AI scoring of Writing (Task 1/2) with teacher overrides and confidence flags.
- Speaking module: recording, storage, rubrics, human scoring workflow.
- OCR for scanned imports and layout-aware table extraction.
- Question-bank reuse across tests (shared item pools) and blueprint-based
  paper generation.
- Materialised analytics rollups and cohort comparison views.
- Outbound e-mail/notification provider (invitations, deadlines, results).
- Two-factor authentication, SSO and per-tenant branding.
- Offline-tolerant exam mode with a service worker and queued synchronisation.
- Mobile-native packaging.
- CSP with nonces/hashes, subresource integrity and an automated security
  header regression test in CI.
- CI pipeline (typecheck + lint + unit + acceptance on every push) and a
  staging environment with seeded smoke tests.
- Proctoring integrations of any kind, including camera/microphone capture —
  intentionally out of scope for a browser-only platform.
- Gamification (streaks, leaderboards, badges) — intentionally excluded from the
  exam experience.
- Predictive or psychological student profiling — intentionally not pursued.
