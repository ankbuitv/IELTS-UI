# Ai eo — exam-style redesign, AI judges, Learn path

This replaces the earlier "light workspace" refresh (cyan/violet SaaS look). The
brief was: drop that interface, build one that looks like the computer-delivered
IELTS screen rather than an AI-generated dashboard, mark Writing and Speaking
automatically with two anonymous judges, add a dictionary and a Duolingo-style
learning path, and forbid leaving the exam tab.

Everything here is **practice tooling**. Ai eo is not affiliated with IELTS, the
British Council, IDP or Cambridge, and every band it shows is labelled an estimate.

---

## 1. Design language

| Decision | Value |
| --- | --- |
| Look | Flat and square: hairline rules, 2–6 px radii, no card shadows (shadows only on overlays). |
| Colour | Crimson `#C8102E` for actions and emphasis, near-black `#14171b` for the top bar, headers and score panels, cool grey canvas. One accent colour per skill (Listening teal, Reading blue, Writing amber, Speaking violet). |
| Type | System Arial/Helvetica stack, no web fonts (the two `@fontsource` packages were removed). Dense by default. |
| Icons | One SVG set (`components/Icon.tsx`). No emoji anywhere in the UI, because they render differently on every device. |
| Dark theme | Re-points the same tokens (`refresh.css`). Surfaces that must stay dark in both themes use `--bar` and `--solid`, never the ink scale (which inverts). |
| Density / size | Base 16 px with compact controls (the first complaint was "too big, looks loose"). Document height equals the viewport on the exam screen; other pages scroll the document. |

Tokens live in `src/client/styles/globals.css` (`:root`). The stylesheets are
split by concern: `globals.css` (tokens + UI kit), `shell.css`, `public.css`
(landing, sign-in, register), `pages.css` (dashboard, practice, results),
`learn.css`, `exam.css`, `refresh.css` (dark theme, display menu, speaking).

### Shell (`components/AppShell.tsx`)

- Top bar on every page: logo, role-aware navigation, **Start a test**, display
  menu, account.
  - Candidate: Home · Learn · Practice · Results · Vocabulary · Dictionary · More.
  - Teacher: Teaching · Marking · Practice · Learn · More. Administrator adds
    Admin first. Candidate places that do not fit sit under **More**.
- Phones get a bottom tab bar (four places + More) and a bottom sheet; tablets
  and desktops get the top navigation. No page checked overflows horizontally at 390 px; wide tables scroll inside their own frame.
- Public pages (landing, sign-in, register) share the same header; the landing
  page shows a sample practice report rather than describing the product.

### Exam screen

Dark title bar (test, autosave state, **Tab lock n/3**, display, dictionary,
timer, Submit), a part tab strip, split panes (passage left, questions right;
a view switch and a draggable divider), grey instruction bands per question
group, a bottom bar with the palette, Prev/Next. Writing is split task / answer
with a live word count. On a phone the panes become a Passage ⇄ Questions toggle.
Essays are also kept in `localStorage` (`aieo.exam-draft.<attemptId>`) so a failing
save never loses work.

### Result report

A dark report header (title, submitted, duration, big band tile), the note on
where each band came from, then per-skill cards. Writing shows the AI panel
(consensus tab, one tab per judge, four criteria with each judge's score,
Vietnamese summary, strengths, work-on-next, corrections). Reading and Listening
show the score, the band (estimated or projected) and the question review.

---

## 2. AI judges

- **Who marks what.** Writing and Speaking are marked by AI automatically;
  Reading and Listening never are (they use the protected answer key).
- **Judge01 / Judge02.** Candidates, teachers and the API only ever see these two
  labels. `ai/judges.ts` resolves them from `OLLAMA_MODEL` (Judge01) and
  `OLLAMA_MODEL_2` (Judge02, default `gemma4:31b`). Model names, vendors,
  endpoints and error text from providers are scrubbed (`ai/failure.ts`); a unit
  test (`judge-anonymity.test.ts`) scans every file the browser downloads for model
  or vendor names.
- **"Training" the judges.** The models are not fine-tuned. Each judge gets the
  same marking brief on **every** call (`MARKING_PROMPT_VERSION`,
  `ai/marking-prompts.ts`): the public band descriptors for each criterion,
  reference essays at 5.0, 6.5 and 8.0 (for scale only), caps for short or off-topic responses,
  and a strict JSON contract. Changing the brief means bumping the version.
- **Panel.** Each judge scores the four criteria and the overall band
  independently. The consensus is the mean (rounded to a half band); a spread of a
  whole band or more is shown as "judges differ". Strengths, improvements and
  corrections are merged without duplicates; the Vietnamese summary is
  Judge01's, or Judge02's if Judge01 is down.
- **When it runs.** Writing: the result page calls `POST /api/attempts/:id/ai-mark`
  as soon as it opens (a long, client-driven request, because background work on
  the platform is cut about 30 s after the response). Speaking: marked inside
  `POST /api/speaking/sessions/:id/submit`. Both are idempotent: only judges that
  have not answered are asked again, `force` re-marks, 30 calls per hour per user.
- **Failure behaviour.** One judge down → `PARTIAL`, the other's mark is shown and
  the missing one is filled in on the next call. Both down → 503 with a generic
  message and a retry button; the work is already saved. The old
  "The AI provider could not mark this response." text is gone.
- **Speaking.** Judges read the transcript, so pronunciation is reported as "not
  assessed" and the other three criteria are marked. A teacher can still score a
  recording.
- **Vocabulary side effect.** Each judge also returns three to five words about
  half a band above the candidate; they are saved to the notebook (origin `AI`).
- **A teacher's band always wins** and is never overwritten by a later AI run.

## 3. Band estimates

| Kind | Source | Label |
| --- | --- | --- |
| Full paper (complete test flag, ≥ profile length) | Scoring profile table | Estimated band |
| Short set, ≥ 8 questions | Raw score scaled to the profile length, then the table | Projected band |
| Fewer than 8 questions | — | Raw score only |
| Writing / Speaking | AI panel | AI judges |
| Writing / Speaking with a teacher mark | Teacher | Teacher |

The dashboard averages the last three attempts per skill, shows the change from
the previous one, and an overall band that is **Provisional** until Listening,
Reading, Writing and Speaking all contribute.

## 4. Tab lock

- Every mode, including practice, has `monitorVisibility` with
  `TAB_LOCK_STRIKES = 3` (`shared/integrity.ts`): a strike when the tab becomes
  hidden, or (on non-touch devices) when the window loses focus for 2.5 s.
- On return a blocking overlay states the strike; the third strike submits the
  attempt (`INTEGRITY_AUTO`), keeps and marks everything answered, and the result
  page says why it ended.
- **What it cannot do:** a web page cannot stop Alt+Tab, another monitor or
  another device. The lock counts, blocks on return and says so on screen; it is
  not proof of misconduct. The exam header shows `Tab lock n/3` at all times.

## 5. Learn path, vocabulary, dictionary

- **Path.** Four units × four lessons × six words (96 words,
  `shared/learn-content.ts`). A lesson builds 12 exercises (`learn-engine.ts`):
  choose, match, fill-in, listen, type, word order. Five hearts per lesson; a
  miss is retried at the end. XP = 10 + exercises right first time (+5 for a
  perfect lesson; repeats pay half). Stars at 70 % / 90 %. Daily goal (default
  30 XP, 10–200) and a day streak. Lessons open in order, but the path starts at
  the learner's level (recent overall band: < 4.5 → 4, < 6 → 5, < 7 → 6, else 7;
  or chosen 4–7).
- **Daily words.** `POST /api/learn/daily-words` asks the AI for words at the
  learner's level (more on request), saved to the notebook. Words missed in a
  lesson also go to the notebook and drop one Leitner box.
- **Review.** Due words come back on a Leitner schedule (`/learn/review`).
- **Dictionary.** `GET /api/dictionary/lookup?term=` resolves word bank → cache
  (`dictionary_cache`) → AI → `api.dictionaryapi.dev`. Used by `/dictionary` and,
  in practice mode only, by the popover in the exam header.

## 6. Data and API

Migration `0009_learn_and_vocabulary.sql`: vocabulary columns (`meaning_vi`,
`pos`, `phonetic`, `example`, `level`, `origin`, and the Leitner fields `box` and `due_at`) and the tables
`learn_profiles`, `learn_lessons_done`, `learn_xp_log`, `dictionary_cache`.
`src/worker/lib/runtime-schema.sql` is regenerated by `npm run schema:generate`.

> **Run `wrangler d1 migrations apply` before the new Worker serves traffic.**
> The Worker repairs a stale schema on first use, and if it adds a column of 0009
> first, the migration later stops with `duplicate column name`.

New endpoints (all scoped to the signed-in user): `/api/learn/overview`,
`/api/learn/lessons/complete`, `/api/learn/review`, `/api/learn/review/complete`,
`/api/learn/daily-words`, `/api/learn/level`, `/api/learn/goal`,
`/api/dictionary/lookup`, `/api/attempts/:id/ai-mark`,
`/api/speaking/sessions/:id/ai-mark`.

## 7. What was verified, and what was not

Verified in this change:

- `npm run lint` (0 errors), `npm run typecheck`, `npm test` (unit suites for the
  panel, band projection, anonymity, Learn engine, chart axes, integrity presets),
  `npm run build`, and the 85-check acceptance run (`npm run test:integration`).
- In Chromium against the local Worker: landing, sign-in and register; dashboard,
  practice, history, vocabulary, dictionary, speaking and learn on phone, tablet
  and desktop; the light and dark themes; teacher and administrator pages; a
  Reading and a Writing attempt end to end, including the Writing result page
  firing the AI marking by itself; the lesson player (a deliberate miss, retry,
  XP, stars, unlock); the tab lock (three strikes → automatic submission, work
  kept, notice on the result); the in-exam dictionary popover.
- Model failures against a **fake OpenAI-compatible provider**: both judges
  answering, one down (`PARTIAL`, then filled in), both down (503), idempotent
  repeat calls, no model name anywhere in student-facing JSON or HTML.

**Not verified:**

- **The real ollama.com models were never called** (the sandbox could not reach
  them). The code uses the direct-API names; confirm `OLLAMA_MODEL` and
  `OLLAMA_MODEL_2` against `GET https://ollama.com/api/tags` and run one Writing
  attempt after deploying. Reply quality, latency and the 30-calls-per-hour limit
  are unmeasured with real models.
- Recording audio in a browser (Speaking was driven through its transcript path).
- Safari and Firefox on real devices, screen readers, and the `Listen` button
  voices (they depend on the device's speech synthesis).

## 8. Follow-ups worth considering

- Move Writing marking to a Queue consumer once a single marking pass reliably
  fits the platform's background-work limit.
- Per-test brief overrides (for example a stricter Task 1 rubric) behind the same
  `MARKING_PROMPT_VERSION`.
- More lessons: the path is data (`learn-content.ts`); units can be added without
  code changes.
