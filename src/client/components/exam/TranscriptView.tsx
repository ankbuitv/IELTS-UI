import { useEffect, useRef, useState } from 'react';
import type { SectionTranscript } from '@shared/sections';
import type { TranscriptWordTiming } from '@shared/transcript-timing';
import { normaliseWord } from '@shared/transcript-timing';
import { formatClock } from '../../lib/format';

/**
 * Listening transcript as a conversation.
 *
 * Segments are laid out the way a transcript is read in class: a speaker label
 * and an avatar at the outer edge, the line in a bubble, and the two voices
 * alternating between the left and the right column. Alternation is derived
 * from the order in which speakers first appear, so a part with two voices
 * reads as a dialogue and a part with a single narrator stays on one side.
 *
 * #38: when word timings are supplied the line is rendered word by word. A
 * click opens a small menu that plays the recording from that word and can look
 * the word up in the dictionary — without leaving the review.
 */
export function TranscriptView({
  transcript,
  highlightSegmentId,
  onSegmentSelect,
  wordTimings,
  onSeekSeconds,
  onLookUpWord,
}: {
  transcript: SectionTranscript;
  /** Segment to emphasise (used when an explanation points at one). */
  highlightSegmentId?: string | null;
  onSegmentSelect?: (segmentId: string) => void;
  /** Word-level timings for this transcript (see `transcript-timing.ts`). */
  wordTimings?: TranscriptWordTiming[];
  /** Play the recording from a given second. */
  onSeekSeconds?: (seconds: number) => void;
  /** Open the dictionary for a word. */
  onLookUpWord?: (word: string) => void;
}) {
  const [openAt, setOpenAt] = useState<{ segmentId: string; index: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openAt) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (menuRef.current && target && !menuRef.current.contains(target) && !target.closest('.convo__word')) {
        setOpenAt(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenAt(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openAt]);

  const sides = new Map<string, 'left' | 'right'>();
  for (const segment of transcript.segments) {
    const speaker = speakerKey(segment.speaker);
    if (!sides.has(speaker)) sides.set(speaker, sides.size % 2 === 0 ? 'left' : 'right');
  }

  const timingsBySegment = new Map<string, TranscriptWordTiming[]>();
  for (const timing of wordTimings ?? []) {
    const list = timingsBySegment.get(timing.segmentId);
    if (list) list.push(timing);
    else timingsBySegment.set(timing.segmentId, [timing]);
  }

  return (
    <div className="convo" aria-label="Transcript">
      {transcript.segments.map((segment) => {
        const speaker = speakerKey(segment.speaker);
        const side = sides.get(speaker) ?? 'left';
        const selected = highlightSegmentId === segment.id;
        const words = timingsBySegment.get(segment.id) ?? [];
        const wordMode = words.length > 0;
        const menuWord = openAt && openAt.segmentId === segment.id ? words[openAt.index] : null;
        return (
          <div key={segment.id} className={`convo__row convo__row--${side}`} id={`segment-${segment.id}`}>
            <span className="convo__avatar" aria-hidden="true">
              {speaker.slice(0, 1).toUpperCase()}
            </span>
            <div className="convo__stack">
              <span className="convo__speaker">{speaker}</span>
              <div className={`convo__bubble ${selected ? 'convo__bubble--selected' : ''} ${wordMode ? 'convo__bubble--words' : ''}`}>
                {wordMode ? (
                  words.map((word, index) => {
                      const open = openAt?.segmentId === segment.id && openAt.index === index;
                      return (
                        <span className="convo__wordwrap" key={`${word.index}-${word.normalized}`}>
                          <button
                            type="button"
                            className={`convo__word ${open ? 'convo__word--open' : ''}`}
                            title={`${formatClock(word.startSeconds)} · jump here`}
                            onClick={() => setOpenAt(open ? null : { segmentId: segment.id, index })}
                          >
                            {word.word}
                          </button>
                          {open && menuWord ? (
                            <span className="convo__wordpop" ref={menuRef} role="menu">
                              <span className="convo__wordpop-time">
                                {formatClock(menuWord.startSeconds)}–{formatClock(menuWord.endSeconds)}
                              </span>
                              {onSeekSeconds ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    onSeekSeconds(menuWord.startSeconds);
                                    setOpenAt(null);
                                  }}
                                >
                                  ▶ Play from here
                                </button>
                              ) : null}
                              {onLookUpWord && menuWord.normalized ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    onLookUpWord(menuWord.normalized || normaliseWord(menuWord.word));
                                    setOpenAt(null);
                                  }}
                                >
                                  Look up “{menuWord.normalized}”
                                </button>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                      );
                    })
                ) : (
                  <button
                    type="button"
                    className="convo__bubble-text"
                    onClick={onSegmentSelect ? () => onSegmentSelect(segment.id) : undefined}
                    disabled={!onSegmentSelect}
                  >
                    {segment.text}
                  </button>
                )}
              </div>
              {segment.startSeconds !== null ? (
                <span className="convo__time">{formatClock(segment.startSeconds)}</span>
              ) : words.length > 0 ? (
                <span className="convo__time">starts {formatClock(words[0]!.startSeconds)}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function speakerKey(speaker: string | null): string {
  return (speaker ?? 'Speaker').trim() || 'Speaker';
}
