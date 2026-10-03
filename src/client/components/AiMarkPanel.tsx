import { useState } from 'react';
import { JUDGE_SPLIT_THRESHOLD, type AiMarkView, type JudgeLabel, type JudgeOpinion } from '@shared/judges';
import { Badge, Tabs } from './ui';
import { Icon } from './Icon';
import { formatBand } from '../lib/format';

type View = 'CONSENSUS' | JudgeLabel;

/**
 * What the two AI judges said about one response: the consensus band and
 * criteria, each judge's own opinion on its own tab, the English feedback with
 * a Vietnamese summary, corrections and next steps.
 *
 * Judges are only ever shown as Judge01 and Judge02. The panel never mentions a
 * model or a provider, and says plainly that the band is an estimate.
 */
export function AiMarkPanel({ mark, heading }: { mark: AiMarkView; heading?: string }) {
  const [view, setView] = useState<View>('CONSENSUS');
  const opinion: JudgeOpinion | null = view === 'CONSENSUS' ? null : (mark.judges.find((judge) => judge.judge === view) ?? null);

  const criteria = opinion ? opinion.criteria : mark.criteria;
  const feedback = opinion ? opinion.feedback : mark.feedback;
  const feedbackVi = opinion ? opinion.feedbackVi : mark.feedbackVi;
  const strengths = opinion ? opinion.strengths : mark.strengths;
  const improvements = opinion ? opinion.improvements : mark.improvements;
  const corrections = opinion ? opinion.corrections : mark.corrections;
  const notes = opinion ? opinion.notes : mark.notes;
  const split = mark.spread !== null && mark.spread >= JUDGE_SPLIT_THRESHOLD;
  const bandShown = opinion ? opinion.band : mark.band;

  const judgeBand = (key: string, label: JudgeLabel): number | null => {
    const found = mark.judges.find((judge) => judge.judge === label)?.criteria.find((criterion) => criterion.key === key);
    return found ? found.band : null;
  };

  return (
    <section className="aimark" aria-label={heading ?? 'AI marking'}>
      <header className="aimark__head">
        <div className="aimark__band" aria-label={`Band ${formatBand(bandShown)}`}>
          <span className="aimark__band-value">{formatBand(bandShown)}</span>
          <span className="aimark__band-label">{view === 'CONSENSUS' ? 'Consensus' : view}</span>
        </div>
        <div className="aimark__who">
          <strong>{heading ?? 'AI marking'}</strong>
          <span>
            {mark.judges.length >= 2
              ? 'Judge01 and Judge02 marked this independently. The band is their average.'
              : mark.unavailable.length > 0
                ? `Marked by ${mark.judges[0]?.judge ?? 'one judge'}. ${mark.unavailable.join(' and ')} could not answer this time.`
                : `Marked by ${mark.judges[0]?.judge ?? 'the judge'}.`}
          </span>
          {split ? (
            <Badge tone="warning">The judges differ by {mark.spread?.toFixed(1)} bands: read both opinions</Badge>
          ) : null}
          {mark.status === 'PARTIAL' ? <Badge tone="warning">Partial result</Badge> : null}
        </div>
      </header>

      {mark.judges.length > 1 ? (
        <Tabs<View>
          value={view}
          onChange={setView}
          tabs={[
            { id: 'CONSENSUS', label: 'Consensus' },
            ...mark.judges.map((judge) => ({ id: judge.judge as View, label: `${judge.judge} · ${formatBand(judge.band)}` })),
          ]}
        />
      ) : null}

      <div className="criteria-grid">
        {criteria.map((criterion) => (
          <article key={criterion.key} className="criterion">
            <div className="criterion__head">
              <span className="criterion__label">{criterion.label}</span>
              <span className="criterion__band">{criterion.band === null ? 'Not assessed' : formatBand(criterion.band)}</span>
            </div>
            {view === 'CONSENSUS' && mark.judges.length > 1 && criterion.band !== null ? (
              <p className="criterion__judges">
                {mark.judges.map((judge) => (
                  <span key={judge.judge}>
                    {judge.judge} <b>{formatBand(judgeBand(criterion.key, judge.judge))}</b>
                  </span>
                ))}
              </p>
            ) : null}
            {criterion.comment ? <p className="criterion__comment">{criterion.comment}</p> : null}
          </article>
        ))}
      </div>

      {feedback ? <p className="aimark__feedback">{feedback}</p> : null}
      {feedbackVi ? (
        <p className="aimark__vi" lang="vi">
          <span>Tóm tắt</span>
          {feedbackVi}
        </p>
      ) : null}

      {strengths.length > 0 || improvements.length > 0 ? (
        <div className="aimark__lists">
          {strengths.length > 0 ? (
            <div>
              <h4>Strengths</h4>
              <ul>
                {strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {improvements.length > 0 ? (
            <div>
              <h4>Work on next</h4>
              <ul>
                {improvements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {corrections.some((correction) => correction.isActualError !== false) ? (
        <div className="aimark__corrections">
          <h4>Corrections</h4>
          {corrections
            .filter((correction) => correction.isActualError !== false)
            .map((correction, index) => (
              <div key={`${correction.original}-${index}`} className="correction-row">
                <span>
                  <del>{correction.original}</del>
                </span>
                <span>
                  <ins>{correction.suggestion}</ins>
                </span>
                {correction.reason ? <span className="correction-row__reason">{correction.reason}</span> : null}
              </div>
            ))}
        </div>
      ) : null}

      {corrections.some((correction) => correction.isActualError === false) ? (
        <div className="aimark__corrections">
          <h4>Suggestions</h4>
          <p className="tiny muted" style={{ margin: '0 0 6px' }}>
            These are optional — your original wording is already correct.
          </p>
          {corrections
            .filter((correction) => correction.isActualError === false)
            .map((correction, index) => (
              <div key={`s-${correction.original}-${index}`} className="correction-row">
                <span>{correction.original}</span>
                <span>
                  <ins>{correction.suggestion}</ins>
                </span>
                {correction.reason ? <span className="correction-row__reason">{correction.reason}</span> : null}
              </div>
            ))}
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul className="aimark__notes">
          {notes.map((note) => (
            <li key={note}>
              <Icon name="info" size={13} /> {note}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="aimark__fine">
        An estimate for study, not an official result and not an examiner. New words from this feedback are added to your
        vocabulary notebook.
      </p>
    </section>
  );
}
