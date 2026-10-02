import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { Badge, SkillGlyph } from './ui';
import {
  formatBand,
  formatDuration,
  formatScore,
  formatShortDate,
  MODE_LABELS,
  statusTone,
  TEST_TYPE_LABELS,
} from '../lib/format';
import type { AttemptSummary } from '../pages/student/types';

/** Newest first, whatever order the caller received them in. */
export function newestFirst<T extends { startedAt: string }>(attempts: T[]): T[] {
  return [...attempts].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/**
 * A scannable list of attempts: skill icon, title, one meta line, the result on
 * the right. Each row is one link (to the result, or back into the exam when it
 * is still running), so the whole row is the tap target on a phone — which a
 * seven-column table never was.
 */
export function AttemptList({ attempts, limit }: { attempts: AttemptSummary[]; limit?: number }) {
  const rows = newestFirst(attempts).slice(0, limit ?? attempts.length);
  return (
    <ul className="attempt-list">
      {rows.map((attempt) => {
        const running = attempt.status === 'IN_PROGRESS';
        const hasBand = attempt.estimatedBand !== null;
        const hasScore = attempt.rawScore !== null && attempt.totalQuestions;
        return (
          <li key={attempt.attemptId}>
            <Link className="attempt-row" to={running ? `/exam/${attempt.attemptId}` : `/attempts/${attempt.attemptId}`}>
              <SkillGlyph type={attempt.testType} />
              <span className="attempt-row__main">
                <span className="attempt-row__title">{attempt.testTitle}</span>
                <span className="attempt-row__meta">
                  {TEST_TYPE_LABELS[attempt.testType] ?? attempt.testType}
                  <span aria-hidden="true"> · </span>
                  {MODE_LABELS[attempt.mode] ?? attempt.mode}
                  <span aria-hidden="true"> · </span>
                  <span title={new Date(attempt.startedAt).toLocaleString()}>{formatShortDate(attempt.startedAt)}</span>
                  {attempt.durationSeconds ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      {formatDuration(attempt.durationSeconds)}
                    </>
                  ) : null}
                  {attempt.assignmentTitle ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      {attempt.assignmentTitle}
                    </>
                  ) : null}
                </span>
              </span>
              <span className="attempt-row__result">
                {running ? (
                  <Badge tone="accent" plain>
                    Resume
                  </Badge>
                ) : hasBand ? (
                  <>
                    <strong className="attempt-row__band">{formatBand(attempt.estimatedBand)}</strong>
                    <span className="attempt-row__sub">{hasScore ? formatScore(attempt.rawScore, attempt.totalQuestions) : 'band'}</span>
                  </>
                ) : hasScore ? (
                  <>
                    <strong className="attempt-row__band">{formatScore(attempt.rawScore, attempt.totalQuestions)}</strong>
                    <span className="attempt-row__sub">raw score</span>
                  </>
                ) : (
                  <Badge tone={statusTone(attempt.status)} plain>
                    {attempt.status.replace('_', ' ').toLowerCase()}
                  </Badge>
                )}
              </span>
              <Icon name="chevronRight" size={16} className="attempt-row__chev" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

