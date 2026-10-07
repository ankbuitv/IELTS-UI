import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LEARN_BANDS, LEARN_BAND_LABELS, LESSON_KIND_LABELS, type EverydayLessonsResponse, type LearnBand } from '@shared/learn';
import { Mascot, mascotForQuestion } from '../../components/learn/Mascot';
import { Icon } from '../../components/Icon';
import { Button, Loading, Notice } from '../../components/ui';
import { describeError } from '../../lib/api';
import { learnApi } from '../../lib/learn-api';

const BAND_STORAGE_KEY = 'aieo.learn-band';

function parseBand(value: string | null): LearnBand | null {
  if (!value) return null;
  const number = Number(value);
  return LEARN_BANDS.find((band) => band === number) ?? null;
}

function initialBand(params: URLSearchParams): LearnBand {
  const fromUrl = parseBand(params.get('band'));
  if (fromUrl !== null) return fromUrl;
  try {
    return parseBand(localStorage.getItem(BAND_STORAGE_KEY)) ?? 5;
  } catch {
    return 5;
  }
}

export function EverydayLessonsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [band, setBand] = useState<LearnBand>(() => initialBand(searchParams));
  const [data, setData] = useState<EverydayLessonsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const mascot = useMemo(() => mascotForQuestion(`everyday:${band}`), [band]);

  useEffect(() => {
    let cancelled = false;
    learnApi.everydayLessons(band)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((cause) => { if (!cancelled) setError(describeError(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [band, reload]);

  const chooseBand = (next: LearnBand) => {
    if (next === band) return;
    setLoading(true);
    setError(null);
    setBand(next);
    setSearchParams({ band: String(next) }, { replace: true });
    try { localStorage.setItem(BAND_STORAGE_KEY, String(next)); } catch { /* The URL retains it. */ }
  };

  const backToLearn = `/learn?band=${encodeURIComponent(String(band))}`;
  const start = (lesson: EverydayLessonsResponse['lessons'][number]) => {
    if (!lesson.unlocked) return;
    const returnTo = `/learn/everyday?band=${encodeURIComponent(String(band))}`;
    navigate(`/learn/lesson/${encodeURIComponent(lesson.id)}?returnTo=${encodeURIComponent(returnTo)}&quote=${encodeURIComponent(lesson.quote)}`);
  };

  return (
    <main className="everyday-page">
      <header className="everyday-hero card">
        <div className="everyday-hero__mascot"><Mascot character={mascot} mood="wave" size={108} /></div>
        <div className="everyday-hero__copy">
          <p className="eyebrow"><Icon name="sparkle" size={14} /> A fresh set every day</p>
          <h1>Everyday Lessons</h1>
          <p>Six short lessons for your band, created for today. Finish each one to open the next; every lesson ends with its own thought to take with you.</p>
          <div className="row everyday-hero__actions">
            <Link className="btn" to={backToLearn}><Icon name="chevronRight" size={15} style={{ transform: 'rotate(180deg)' }} /> Back to Learn</Link>
            <span className="everyday-hero__date">{data?.day ?? 'Today'} · Band {band.toFixed(1)}</span>
          </div>
        </div>
      </header>

      <section className="everyday-band card" aria-label="Select a band">
        <div>
          <h2>Choose your band</h2>
          <p className="muted small">The six lessons are tailored to this level and stay saved for today.</p>
        </div>
        <div className="everyday-band__choices">
          {LEARN_BANDS.map((item) => (
            <button key={item} type="button" className={`everyday-band__choice${band === item ? ' is-on' : ''}`} onClick={() => chooseBand(item)} aria-pressed={band === item}>
              <b>{item.toFixed(1)}</b><span>{LEARN_BAND_LABELS[item]}</span>
            </button>
          ))}
        </div>
      </section>

      {loading ? <div className="card everyday-loading"><Loading label="Creating today’s six lessons… This can take a little while." /></div> : null}
      {error ? (
        <Notice tone="danger" title="Everyday Lessons could not load">
          <p>{error}</p>
          <Button size="sm" onClick={() => { setLoading(true); setError(null); setReload((value) => value + 1); }}>Try again</Button>
        </Notice>
      ) : null}

      {!loading && !error && data ? (
        <section className="everyday-set" aria-label="Today’s lessons">
          <div className="everyday-set__heading">
            <div><p className="eyebrow">{data.day}</p><h2>Today’s six</h2></div>
            <span className="everyday-set__progress">{data.lessons.filter((lesson) => lesson.completed).length}/6 complete</span>
          </div>
          <ol className="everyday-list">
            {data.lessons.map((lesson) => (
              <li key={lesson.id} className={`everyday-item${lesson.completed ? ' is-done' : ''}${!lesson.unlocked ? ' is-locked' : ''}`}>
                <div className="everyday-item__number" aria-hidden="true">{lesson.completed ? <Icon name="check" size={19} strokeWidth={3} /> : String(lesson.slot + 1).padStart(2, '0')}</div>
                <div className="everyday-item__body">
                  <div className="everyday-item__meta"><span>{LESSON_KIND_LABELS[lesson.kind]}</span><span>{lesson.questionCount} questions</span></div>
                  <h3>{lesson.title}</h3>
                  <p>{lesson.blurb}</p>
                  <span className="everyday-item__quote">“{lesson.quote}”</span>
                </div>
                <Button variant={lesson.completed ? 'secondary' : lesson.unlocked ? 'primary' : 'secondary'} disabled={!lesson.unlocked} onClick={() => start(lesson)}>
                  {!lesson.unlocked ? <><Icon name="lock" size={15} /> Locked</> : lesson.completed ? 'Practise again' : <><Icon name="play" size={14} filled /> Start</>}
                </Button>
              </li>
            ))}
          </ol>
          <p className="everyday-set__note muted small">The next lesson unlocks as soon as the current one is completed. A new set is made when the day changes.</p>
        </section>
      ) : null}
    </main>
  );
}
