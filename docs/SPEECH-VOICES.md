# Speech accents (#39)

The listening exercises can be rehearsed in the three accents IELTS actually
uses: British (`UK`), Australian (`AU`) and American (`US`).

## Server voices

- `GET /api/learn/speech/voices` returns the 13 provider voices, the three
  accents and the default accent. It now checks `aiStatus` instead of
  synthesising a throwaway "ping" on every page load.
- `GET /api/learn/speech?text=…&voice=…&accent=UK` synthesises with
  `gpt-4o-mini-tts` and passes an accent instruction:
  - UK — "natural British Received Pronunciation accent";
  - AU — "natural Australian accent";
  - US — "natural General American accent".
- The cache key is `voice:accent:textHash`, so the same word in UK and AU is
  cached separately and never plays with the wrong accent.

## Device voices

When no provider is configured the browser's own voices are used. `speak()`
picks a voice whose language tag matches the chosen accent (`en-GB`, `en-AU`,
`en-US`) and rejects a stored voice that belongs to another region — a UK
exercise will not suddenly sound American. The choice is stored in
`localStorage` under `aieo.accent` and read by every `speak()` call, so the
dictionary and vocabulary pages follow the same accent without extra UI.

## UI

`LessonPlayer` shows a three-way `UK | AU | US` control next to the voice
select. Switching accent re-speaks the current word immediately and clears a
device voice that does not match the new accent, so what is shown in the select
is what will be heard.
