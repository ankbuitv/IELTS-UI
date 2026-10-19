# Sample content

Original practice material shipped with the platform. None of it is official
IELTS, British Council, IDP or Cambridge material.

| File | Format |
| --- | --- |
| `cities-knowledge-and-adaptation.json` | Import paste format (`testType` + `passages` + inline answers) |
| `cities-knowledge-and-adaptation.source.json` | Authoring format (`schemaVersion` + `questionGroups` + `answerKey`) |
| `full-test.json` | One-file `FULL_MOCK` (`testType: FULL_MOCK` + every section inline, no mock components) |
| `reading-four-passages.json` | Four separate Reading passages in one file (40 questions, Q1–40) |
| `band-8-reading-set.json` | Three Reading passages in difficulty order, band 7.5 → 8.5 (Q1–40, sectioned format) |
| `listening-part1-bookbinding.json` | Listening Part 1, table completion (Q1–10, **platform content schema** because it needs `body`) |
| `writing-60-minute-set.json` | Standalone 60-minute Writing paper: Task 1 data table (Q1, 150+ words) + Task 2 discussion essay (Q2, 250+ words), sectioned format |

The first two files describe the same 40-question Academic-style Reading set,
**Cities, Knowledge and Adaptation**. Paste either into Admin → Imports. Extra
JSON after the first object is ignored, so concatenating the two files no longer
fails with `Unexpected non-whitespace character after JSON`.

`reading-four-passages.json` is the multi-passage answer to "four reading tests in
one JSON": four independent passages (each its own paragraph set A–E) with five
question groups apiece, covering TRUE/FALSE/NOT GIVEN, YES/NO/NOT GIVEN,
multiple choice, matching information, matching headings, sentence completion
and summary completion. Every question carries its answer, a verbatim passage
quote as marking evidence and a short explanation, so Applying it produces a
publishable 40-question READING test with no manual key entry.
`tests/unit/reading-sample.test.ts` runs it through the same conversion and
validator the importer uses, so the file cannot drift out of the platform's
evidence rules unnoticed.

`band-8-reading-set.json` is written in the **sectioned** format (one
`reading_passage` section per text, `questionGroups` with `fromQuestion` /
`toQuestion`) and is ordered by difficulty rather than by topic: Passage 1 is a
785-word historical-scientific text at band 7.5 (headings, TRUE/FALSE/NOT GIVEN,
one-word sentence completion), Passage 2 is 945 words at band 8.0 and shifts to
writer's-claims items (matching information, YES/NO/NOT GIVEN, multiple choice),
Passage 3 is 1051 words at band 8.5 (headings, matching features across four
named researchers, two-word summary completion). Option banks are deliberately
out of sequence, so a key cannot be guessed from the order of the list. Every
answer carries a verbatim sentence of its own passage as `evidence` plus an
`explanation`, so Applying it needs no manual key entry, and the `[[n]]` markers
make the two completion groups render as real gap-fill forms.

`writing-60-minute-set.json` is the first sample with real Writing content
(`full-test.json` carries Task 1 & 2 slots with placeholder prompts). It is a
complete 60-minute paper in the sectioned format: Task 1 (20′, min 150 words)
is a data task built around a household-recycling table written as prose —
the exam UI renders question prompts in a plain paragraph, so the figures
travel in the text rather than a chart image — and Task 2 (40′, min 250
words) is a discuss-both-views-and-opinion essay on road-safety punishments.
Writing tasks deliberately carry **no `answer`**: `convertAiPayload` treats
`WRITING_TASK_1` / `WRITING_TASK_2` groups as teacher/AI-marked and excludes
them from the answer-key confidence, so the import reports `ABSENT` without a
missing-key warning. Each question's `explanation` is a self-study marking
guide (what a Band 8 answer does on that exact task) that the review view
shows after the attempt. `tests/unit/writing-sample.test.ts` runs the file
through the same conversion and validator the importer uses.

`listening-part1-bookbinding.json` is the exception to "use the sectioned
format": a **table** task only renders as a table when the candidate payload
carries `question.body = { kind: 'TABLE', rows: [[…]] }` with `[[n]]` inside a
cell (`src/client/components/exam/QuestionRenderer.tsx`), and the sectioned
importer parses `audioUrl` / `transcript` but not `body`. The file is therefore
written in the platform content schema (`sections[].groups[]`), which carries
`body`, `audioUrl`, `playback` and `transcript` together — and which
`convertAiPayload` recognises first, so it still pastes into
Administration → Imports as well as into the version editor's JSON tab. Every
gap's `evidence` is a transcript segment reference (`segment:bp11`), which is
what links the review panel to the line that contains the answer; the segments
carry no `startSeconds` because the recording's cue times are unknown, and the
seek control stays inert until they are added in the JSON (editing the
transcript in the editor instead regenerates ids as `seg-N` and breaks the
`segment:` references).

All five files also work in the **version editor's JSON tab**
(Admin → Tests → version → Edit content → JSON): *Parse into outline* and
*Save content* run them through the same shared conversion as the import
pipeline (`src/shared/import-convert.ts`), so an import-format paste is turned
into the platform content schema instead of being rejected with per-section
`Invalid option` errors.

`full-test.json` is a complete 52-question paper in a single JSON: Listening
Part 2 (Q1–10), three Reading passages (Q11–50) and Writing Task 1 & 2
(Q51–52). It needs the one-file full-mock support in
`src/worker/services/attempt-service.ts` (`inlineMockComponentRows`): the
attempt groups consecutive same-skill sections into Listening → Reading →
Writing skill sessions (30′/60′/60′ by default). Its `audioUrl` is a production
asset id (`ast_…`): Apply succeeds there, but a local database without that
asset rejects Apply with *"One of the referenced assets (section audio) no
longer exists"* — swap `audioUrl` for an `https://` URL (or register an asset
with the same id) before applying locally.
