# Content imports (AI generation and OCR)

Admin → **Imports** has four ways in. Every path ends in an `imports` row with
status **REVIEW**; nothing is published without a human applying the draft.

| Tab | Endpoint | What it does | Provenance |
| --- | --- | --- | --- |
| Paste text or JSON | `POST /api/admin/imports/paste` | Validated JSON becomes a draft immediately; plain text is stored for AI structuring or manual editing. | Chosen by the admin |
| Upload a document | `POST /api/admin/imports` | PDF (text layer), DOCX, TXT, MD, CSV. Scanned PDFs are reported, not guessed. | Chosen by the admin |
| Scan or photo (OCR) | `POST /api/admin/imports/ocr` | 1–8 page images (PNG/JPEG/WebP, 8 MB each) are transcribed by the vision model and structured in the same request. | `IMPORTED`, `source_title` records the page count |
| Generate with AI | `POST /api/admin/imports/generate` | An admin brief becomes an original Reading test (1–3 sections, 5–14 questions each, target band). | `AI_GENERATED` |

## AI generation (#36)

- `generateTestFromPrompt` uses a system prompt that forbids reproducing real
  IELTS/Cambridge/BC/IDP material, requires a supporting sentence and a
  one-sentence explanation per question, and asks for consecutive numbering.
- The generated payload goes through the normal `convertAiPayload` validation
  and lands in `import_drafts` with the issue list attached.
- Rate limit: 12 generated tests per admin per hour.
- Listening and Writing generation are deliberately closed: there is no audio
  synthesis pipeline for a consistent listening section, and a Writing task
  needs a band-specific rubric the model cannot self-certify.

## OCR (#37)

- `createOcrImport` validates page count/format/size **before** calling the
  model, so bad uploads fail with a 400 even when AI is not configured.
- Page images are inlined as data URLs into the chat request and are not stored.
  The structured payload and its checksum are recorded; the audit entry is
  `IMPORT_OCR`.
- When the provider is missing the endpoint returns `503 AI_UNAVAILABLE` with a
  message telling the admin to paste the text instead.
- OCR of a scanned PDF is not attempted: Workers cannot rasterise PDFs, and
  PDFs without a text layer are reported at upload time. Export the pages as
  images instead.

## Reviewing a draft

`ImportDetailView` shows the structured payload, validation issues, provenance
and answer-key confidence. `POST /api/admin/imports/:id/apply` creates the test
version; `answerKeyConfidence` other than `PROVIDED` is surfaced so an absent
key cannot be published unnoticed.
