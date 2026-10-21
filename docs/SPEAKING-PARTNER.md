# AI speaking partner (#35)

A turn-based speaking rehearsal at `/speaking/partner`. The partner asks one
question, the learner answers in text or by dictation, and the answer gets two
or three concrete notes before the next question.

## Data

Migration `0038_speaking_partner.sql`:

- `speaking_partner_sessions` — one row per rehearsal (`user_id`, `topic_id`,
  `part`, `status`, `summary_json`).
- `speaking_partner_turns` — ordered turns (`seq`, `role` PARTNER/CANDIDATE,
  `content`, `feedback_json`), unique on `(session_id, seq)`.

Topics live in `src/shared/speaking-partner.ts` (9 topics across Parts 1–3), so
the client can render the lobby before any request and the worker can validate
the choice.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/student/speaking-partner/topics` | Static topic list |
| GET | `/api/student/speaking-partner/sessions` | Recent rehearsals (40) |
| POST | `/api/student/speaking-partner/sessions` | `{topicId}`, CSRF; writes the opening partner turn |
| GET | `/api/student/speaking-partner/sessions/:id` | Session + turns + summary |
| POST | `/api/student/speaking-partner/sessions/:id/turns` | `{content}` ≤1500 chars, CSRF; returns the session with the new coaching |
| POST | `/api/student/speaking-partner/sessions/:id/summary` | Finishes the session, stores the summary |

Limits: 30 new sessions/hour, 80 answers/hour, 12 turns of history sent to the
model.

## AI and fallback

Each answer asks the model for `{reply, feedback:{notes, betterPhrase,
encourage}}` and validates it with zod. When the provider is missing or returns
something unusable, the turn still succeeds:

- the next question comes from the topic's `followUps`;
- `ruleFeedback` checks answer length, linking words, filler words and short
  sentences;
- the summary comes from `ruleSummary`, which counts answers and carries the
  coaching notes forward.

`feedback.source` is `AI` or `RULES`, and the UI labels it ("AI coach" / "Quick
check") so a rule-based note is never presented as model judgement.

## No bands

Neither the partner nor the summary assigns a band. The final card says the
feedback is practice feedback and links to `/speaking` for a scored mock. This
keeps scoring in the judge pipeline, where two judges and the consensus rule
apply.
