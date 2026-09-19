import type { SectionTranscript } from '@shared/sections';
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
 * Segments keep their `segment-<id>` anchor so review material (an explanation
 * that cites `segment:ls1-03`) can link straight to the line.
 */
export function TranscriptView({
  transcript,
  highlightSegmentId,
  onSegmentSelect,
}: {
  transcript: SectionTranscript;
  /** Segment to emphasise (used when an explanation points at one). */
  highlightSegmentId?: string | null;
  onSegmentSelect?: (segmentId: string) => void;
}) {
  const sides = new Map<string, 'left' | 'right'>();
  for (const segment of transcript.segments) {
    const speaker = speakerKey(segment.speaker);
    if (!sides.has(speaker)) sides.set(speaker, sides.size % 2 === 0 ? 'left' : 'right');
  }

  return (
    <div className="convo" aria-label="Transcript">
      {transcript.segments.map((segment) => {
        const speaker = speakerKey(segment.speaker);
        const side = sides.get(speaker) ?? 'left';
        const selected = highlightSegmentId === segment.id;
        return (
          <div key={segment.id} className={`convo__row convo__row--${side}`} id={`segment-${segment.id}`}>
            <span className="convo__avatar" aria-hidden="true">
              {speaker.slice(0, 1).toUpperCase()}
            </span>
            <div className="convo__stack">
              <span className="convo__speaker">{speaker}</span>
              <button
                type="button"
                className={`convo__bubble ${selected ? 'convo__bubble--selected' : ''}`}
                onClick={onSegmentSelect ? () => onSegmentSelect(segment.id) : undefined}
                disabled={!onSegmentSelect}
              >
                {segment.text}
              </button>
              {segment.startSeconds !== null ? (
                <span className="convo__time">{formatClock(segment.startSeconds)}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Speaker label for display; unnamed segments become a neutral "Narrator". */
function speakerKey(speaker: string | null): string {
  const value = (speaker ?? '').trim();
  return value.length > 0 ? value : 'Narrator';
}
