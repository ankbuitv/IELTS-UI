/**
 * Printable certificate for a completed attempt.
 *
 * This is a practice record, not an official IELTS certificate — the wording
 * on the sheet says so. The page prints in landscape with the app chrome
 * hidden (see `certificate.css`), so "Save as PDF" in the browser dialog
 * produces a clean sheet.
 */
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../context/AuthContext';
import { Loading, Notice } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatBand, formatDateTime, SKILL_LABELS } from '../../lib/format';
import type { AttemptResultPayload } from '../../components/ResultView';

export function CertificatePage() {
  const { attemptId = '' } = useParams();
  const { user } = useAuth();
  const { data, loading, error } = useAsync<AttemptResultPayload>(
    () => api.get(`/api/attempts/${attemptId}/result`),
    [attemptId],
  );

  if (loading && !data) return <Loading label="Preparing your certificate…" />;
  if (error && !data) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  const band = data.estimatedBand;
  if (!data.release?.scoreAvailable || band === null) {
    return (
      <div className="stack">
        <Link className="btn btn--ghost btn--sm" to={`/exam/${attemptId}/review`}>
          <Icon name="chevronRight" size={13} className="icon--flip" /> Back to the review
        </Link>
        <Notice tone="info" title="No certificate yet">
          The score for this attempt has not been released, or it was a practice set without a band estimate.
          Complete a scored mock and the certificate appears here.
        </Notice>
      </div>
    );
  }

  const name = user?.displayName || user?.username || 'Candidate';
  const issued = data.submittedAt ?? data.startedAt;
  const skills = data.sessions
    .filter((session) => session.band !== null)
    .map((session) => ({
      label: SKILL_LABELS[session.skill as keyof typeof SKILL_LABELS] ?? session.label ?? session.skill,
      band: session.band,
    }));

  return (
    <div className="cert-page">
      <div className="cert-actions">
        <Link className="btn btn--ghost btn--sm" to={`/exam/${attemptId}/review`}>
          <Icon name="chevronRight" size={13} className="icon--flip" /> Back to the review
        </Link>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => window.print()}>
          <Icon name="download" size={13} /> Print / save as PDF
        </button>
      </div>

      <article className="cert-sheet" aria-label="Practice certificate">
        <span className="cert-frame" aria-hidden="true" />
        <header className="cert-head">
          <div className="cert-brand">
            <span className="cert-mark">AI</span>
            <div>
              <strong>AI Eo</strong>
              <span>IELTS practice platform</span>
            </div>
          </div>
          <span className="cert-no">No. {attemptId.slice(0, 10).toUpperCase()}</span>
        </header>

        <div className="cert-body">
          <p className="cert-eyebrow">Certificate of achievement</p>
          <h1 className="cert-name">{name}</h1>
          <p className="cert-lede">has completed a full-length scored practice test</p>
          <h2 className="cert-test">{data.testTitle}</h2>

          <div className="cert-score">
            <span className="cert-score__label">Overall practice band</span>
            <strong className="cert-score__band">{formatBand(band)}</strong>
            <span className="cert-score__scale">out of 9.0</span>
          </div>

          {skills.length > 1 ? (
            <ul className="cert-skills">
              {skills.map((skill) => (
                <li key={skill.label}>
                  <span>{skill.label}</span>
                  <b>{formatBand(skill.band)}</b>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <footer className="cert-foot">
          <div>
            <span className="cert-foot__label">Issued</span>
            <strong>{formatDateTime(issued)}</strong>
          </div>
          <div className="cert-seal" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="58" height="58">
              <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="32" cy="32" r="21" fill="none" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 3" />
              <path d="M32 15l4.6 9.4 10.4 1.5-7.5 7.3 1.8 10.3L32 38.7 22.7 43.5l1.8-10.3-7.5-7.3 10.4-1.5Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <span>Practice record</span>
          </div>
          <div className="cert-sign">
            <span className="cert-sign__line" />
            <span className="cert-foot__label">AI examiners · two independent judges</span>
          </div>
        </footer>

        <p className="cert-note">
          This is a practice record generated by AI Eo. Band scores are AI estimates and do not constitute an official
          IELTS result. Verify this sheet at {window.location.origin.replace(/^https?:\/\//, '')}/certificate/
          {attemptId}.
        </p>
      </article>
    </div>
  );
}
