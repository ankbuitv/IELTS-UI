# Sample content

Original practice material shipped with the platform. None of it is official
IELTS, British Council, IDP or Cambridge material.

| File | Format |
| --- | --- |
| `cities-knowledge-and-adaptation.json` | Import paste format (`testType` + `passages` + inline answers) |
| `cities-knowledge-and-adaptation.source.json` | Authoring format (`schemaVersion` + `questionGroups` + `answerKey`) |

Both files describe the same 40-question Academic-style Reading set, **Cities,
Knowledge and Adaptation**. Paste either into Admin → Imports. Extra JSON after
the first object is ignored, so concatenating the two files no longer fails
with `Unexpected non-whitespace character after JSON`.
