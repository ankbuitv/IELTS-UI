import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LEARN_BANDS, LEARN_BAND_LABELS, type LearnBand, type PlanView } from '@shared/learn';
import { useAsync } from '../../hooks/useAsync';
import { Icon } from '../../components/Icon';
import { Button, Loading, Modal, Notice, useToast } from '../../components/ui';
import { describeError } from '../../lib/api';
import { learnApi, localDay } from '../../lib/learn-api';

const SKILL_LABELS: Record<string, string> = {
  READING: 'Reading',
  LISTENING: 'Listening',
  WRITING: 'Writing',
};

/**
 * The study plan.
 *
 * The path shows what exists; this shows what to do today. It is built from the
 * bands the learner has actually scored, plus a target and an exam date, and it
 * is stored once built so the same day means the same thing every time the page
 * is opened.
 *
 * Rebuilding is a deliberate act, not something that happens when a test is
 * marked: a plan that rearranged itself under a learner would move their ticks
 * onto different lessons.
 */
export function PlanPage() {
  const toast = useToast();
  const today = localDay();
  const plan = useAsync<{ plan: PlanView | null }>(() => learnApi.plan(), []);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [targetBand, setTargetBand] = useState<LearnBand>(6.5);
  const [examDay, setExamDay] = useState('');
  const [minutes, setMinutes] = useState(30);

  const data = plan.data?.plan ?? null;

  const build = async () => {
    setBusy(true);
    try {
      await learnApi.buildPlan({ targetBand, examDay: examDay || null, minutesPerDay: minutes });
      setFormOpen(false);
      await plan.reload();
      toast.push('Your plan is ready.', 'success');
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: string, done: boolean) => {
    try {
      await learnApi.setPlanItem(id, done ? 'DONE' : 'PENDING');
      await plan.reload();
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    }
  };

  const knownSkills = useMemo(
    () => (data ? Object.entries(data.skillBands).filter(([, band]) => typeof band === 'number') : []),
    [data],
  );

  if (plan.loading && !plan.data) return <Loading label="Loading your plan…" />;
  if (plan.error && !plan.data) {
    return (
      <Notice tone="danger" title="The plan could not be loaded">
        {plan.error}
      </Notice>
    );
  }

  const form = (
    <Modal open={formOpen} onClose={() => setFormOpen(false)} title={data ? 'Rebuild your plan' : 'Build your plan'}>
      <p className="muted small">
        Lessons are pitched from the band you are at now and climb towards your target. A mock test lands every seventh
        day and a review every third.
      </p>
      <label className="field">
        <span>Target band</span>
        <div className="level-choices">
          {LEARN_BANDS.map((band) => (
            <button
              key={band}
              type="button"
              className={`level-choice${targetBand === band ? ' is-on' : ''}`}
              onClick={() => setTargetBand(band)}
            >
              <b>{band.toFixed(1)}</b>
              <span>{LEARN_BAND_LABELS[band]}</span>
            </button>
          ))}
        </div>
      </label>
      <label className="field">
        <span>Exam date (optional)</span>
        <input type="date" value={examDay} min={today} onChange={(event) => setExamDay(event.target.value)} />
      </label>
      <label className="field">
        <span>Minutes a day: {minutes}</span>
        <input
          type="range"
          min={10}
          max={120}
          step={5}
          value={minutes}
          onChange={(event) => setMinutes(Number(event.target.value))}
        />
      </label>
      <div className="row">
        <Button variant="primary" loading={busy} onClick={() => void build()}>
          {data ? 'Rebuild plan' : 'Build plan'}
        </Button>
        <Button onClick={() => setFormOpen(false)}>Cancel</Button>
      </div>
    </Modal>
  );

  if (!data) {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>Study plan</h1>
            <p className="page-head__meta">A dated route from your current band to the one you want.</p>
          </div>
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            Build my plan
          </Button>
        </div>
        <section className="card plan-empty">
          <h2>What a plan does</h2>
          <ul className="muted small">
            <li>Reads the bands from your recent practice tests and starts just above them.</li>
            <li>Spreads the climb to your target evenly, so you arrive near the end rather than in week one.</li>
            <li>Puts a mock test every seventh day and a notebook review every third.</li>
            <li>Keeps the same days every time you open it, until you rebuild it yourself.</li>
          </ul>
        </section>
        {form}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Study plan</h1>
          <p className="page-head__meta">
            Band {data.currentBand.toFixed(1)} now → <b>{data.targetBand.toFixed(1)}</b> target
            {data.examDay ? ` · exam ${data.examDay}` : ''} · {data.minutesPerDay} min/day · {data.daysCovered} days
          </p>
        </div>
        <div className="row">
          <Link className="btn" to="/learn">
            Open the path
          </Link>
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            Rebuild
          </Button>
        </div>
      </div>

      {knownSkills.length > 0 ? (
        <section className="plan-skills" aria-label="Your bands by skill">
          {knownSkills.map(([skill, band]) => (
            <div key={skill} className="plan-skill">
              <span>{SKILL_LABELS[skill] ?? skill}</span>
              <b>{(band as number).toFixed(1)}</b>
            </div>
          ))}
        </section>
      ) : (
        <Notice tone="info">
          Take a practice test and the plan will know which skill to push. Until then it works from your overall band.
        </Notice>
      )}

      <section className="plan-stats card">
        <div>
          <b>{data.stats.done}</b>
          <span>of {data.stats.total} steps done</span>
        </div>
        <div>
          <b>{data.stats.lessons}</b>
          <span>lessons</span>
        </div>
        <div>
          <b>{data.stats.mocks}</b>
          <span>mock tests</span>
        </div>
      </section>

      {data.today.length > 0 ? (
        <section className="card">
          <header className="plan-day__head">
            <h2>Today</h2>
          </header>
          <ul className="plan-items">
            {data.today.map((item) => (
              <PlanItemRow key={item.id} item={item} onToggle={toggle} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="plan-days">
        {data.days.map((group) => (
          <details key={group.day} className="plan-day card" open={group.day === today}>
            <summary className="plan-day__head">
              <h2>{group.day}</h2>
              <span className="muted small">
                {group.items.filter((item) => item.status === 'DONE').length}/{group.items.length}
              </span>
            </summary>
            <ul className="plan-items">
              {group.items.map((item) => (
                <PlanItemRow key={item.id} item={item} onToggle={toggle} />
              ))}
            </ul>
          </details>
        ))}
      </section>

      {form}
    </div>
  );
}

function PlanItemRow({
  item,
  onToggle,
}: {
  item: PlanView['today'][number];
  onToggle: (id: string, done: boolean) => void;
}) {
  const target =
    item.kind === 'LESSON' && item.lessonId
      ? `/learn/lesson/${item.lessonId}?returnTo=%2Flearn%2Fplan`
      : item.kind === 'REVIEW'
        ? '/learn/review'
        : item.kind === 'MOCK_TEST'
          ? '/practice'
          : null;
  const done = item.status === 'DONE';
  return (
    <li className={`plan-item plan-item--${item.kind.toLowerCase()}${done ? ' is-done' : ''}`}>
      <button
        type="button"
        className="plan-item__tick"
        aria-pressed={done}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        onClick={() => onToggle(item.id, !done)}
      >
        <Icon name="check" size={14} strokeWidth={3.2} />
      </button>
      <div className="plan-item__body">
        <b>{item.kind === 'LESSON' ? (item.lessonTitle ?? item.label) : item.label}</b>
        {item.lessonId && !item.lessonTitle ? <span className="muted tiny">That lesson was removed.</span> : null}
        {item.band ? <em className="plan-item__band">{item.band.toFixed(1)}</em> : null}
      </div>
      {target ? (
        <Link className="plan-item__go" to={target} aria-label={`Open ${item.label}`}>
          <Icon name="arrowRight" size={15} strokeWidth={2.4} />
        </Link>
      ) : null}
    </li>
  );
}
