# Sample content

Original practice material shipped with the platform. None of it is official
IELTS, British Council, IDP or Cambridge material.

| File | Format |
| --- | --- |
| `cities-knowledge-and-adaptation.json` | Import paste format (`testType` + `passages` + inline answers) |
| `cities-knowledge-and-adaptation.source.json` | Authoring format (`schemaVersion` + `questionGroups` + `answerKey`) |
| `full-test.json` | One-file `FULL_MOCK` (`testType: FULL_MOCK` + every section inline, no mock components) |

The first two files describe the same 40-question Academic-style Reading set,
**Cities, Knowledge and Adaptation**. Paste either into Admin → Imports. Extra
JSON after the first object is ignored, so concatenating the two files no longer
fails with `Unexpected non-whitespace character after JSON`.

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
