import { Icon } from '../Icon';
import { choiceLabel } from './QuestionRenderer';

/**
 * "Why is this the answer?" panel shown in released review.
 *
 * Evidence and explanations are answer material: they are only ever sent to the
 * browser for a released result, never during a live attempt. When the review
 * payload cites a transcript segment (`segment:ls1-03`), listening results also
 * offer a one-click jump to that point in the recording.
 */
export function AnswerExplanation({
  number,
  evidence,
  explanation,
  correctAnswer,
  transcriptSegmentId,
  onListenFrom,
}: {
  number: number;
  evidence: string | null;
  explanation: string | null;
  correctAnswer: string | null;
  /** Transcript segment the evidence points at, when the payload names one. */
  transcriptSegmentId?: string | null;
  onListenFrom?: (segmentId: string) => void;
}) {
  if (!evidence && !explanation && !correctAnswer) return null;

  return (
    <div className="explain" id={`explain-${number}`}>
      <div className="explain__head">
        <span className="explain__title">
          <Icon name="info" size={15} />
          Explanation · Question {number}
        </span>
        {transcriptSegmentId && onListenFrom ? (
          <button type="button" className="btn btn--sm" onClick={() => onListenFrom(transcriptSegmentId)}>
            <Icon name="play" size={13} />
            Listen from here
          </button>
        ) : null}
      </div>
      <div className="explain__body">
        {explanation ? (
          <p className="explain__text">
            <span className="explain__label">Why</span>
            {explanation}
          </p>
        ) : null}
        {evidence ? (
          <p className="explain__text explain__text--evidence">
            <span className="explain__label">Evidence</span>
            {evidence}
          </p>
        ) : null}
        {correctAnswer ? (
          <p className="explain__answer">
            <Icon name="check" size={14} strokeWidth={2.6} />
            Answer: <strong>{choiceLabel(correctAnswer)}</strong>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Extracts the transcript segment a piece of evidence refers to, if any.
 * Evidence may be written as `segment:ls1-03` or link to it inline; both are
 * recognised so an institution can keep using the notation it prefers.
 */
export function evidenceSegmentId(evidence: string | null | undefined): string | null {
  if (!evidence) return null;
  const match = /segment:([A-Za-z0-9_-]+)/.exec(evidence);
  return match?.[1] ?? null;
}
