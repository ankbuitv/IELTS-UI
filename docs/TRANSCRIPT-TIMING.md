# Word-level listening transcripts (#38)

`src/shared/transcript-timing.ts` turns a listening transcript into per-word
timings. It is pure TypeScript, shared by the client and testable in isolation.

## How timings are derived

1. **Explicit anchors win.** A segment whose `startSeconds` is set keeps that
   start.
2. **Neighbours fill the gaps.** Segments between two anchors are spaced inside
   that window by word weight; segments before the first anchor step back from
   it at the reading pace; segments after the last anchor continue forward.
3. **The audio duration is the best input.** The review player reports
   `duration` on `loadedmetadata`; with no anchors at all the transcript is
   spread across the recording instead of drifting.
4. **No audio, no anchors?** A 2.6-words-per-second pace keeps every word
   addressable, which is what the UI needs.

Word weights use letter/digit count, so a long word occupies more of its
segment than "a" or "the". The result lands within a word or two of the real
position — enough for "listen from here" and in-place lookup, without shipping a
forced-alignment model.

## "Listen from here"

`findEvidenceStart(timings, segmentId, evidence)` strips the
`segment:<id>` marker from the evidence, then finds the longest run of quoted
words inside that segment (at most one skipped word). The review page seeks to
that word's start. Paraphrased evidence falls back to the segment start; the
button therefore never jumps to the wrong part.

## In the review UI

`TranscriptView` renders the transcript word by word when timings are supplied.
Clicking a word opens a small menu with:

- the word's time range;
- **Play from here** (seeks the section recording);
- **Look up "word"**, opening the exam dictionary with the term prefilled.

The dictionary closes with Escape or a click outside. On narrow screens the
menu opens below the word so it is never clipped by the top of the pane.

## Limits

Timings are estimates unless the audio duration (or author-supplied anchors)
match the real recording. Sections without an audio asset still get timings for
lookup, but the play action is hidden because there is nothing to play.
