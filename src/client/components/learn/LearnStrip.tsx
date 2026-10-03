import { Link } from 'react-router-dom';
import { streakAlive } from '@shared/learn';
import { useAsync } from '../../hooks/useAsync';
import { learnApi, localDay } from '../../lib/learn-api';
import { Icon } from '../Icon';

/**
 * Three small cards on the dashboard: the streak, today's XP against the goal and the words
 * due for review. Each one opens the learning path. They stay out of the way when the request
 * fails: this is a convenience, never a reason for the dashboard to show an error.
 */
export function LearnStrip() {
  const { data, loading } = useAsync(() => learnApi.overview(), []);

  if (!data) {
    // Reserve the space while loading so the page below does not jump.
    return loading ? (
      <section className="learn-strip" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className="ls-card ls-card--skeleton" />
        ))}
      </section>
    ) : null;
  }

  const { profile } = data;
  const today = localDay();
  const alive = streakAlive(profile.lastActiveDay, today) && profile.streak > 0;
  const activeToday = profile.lastActiveDay === today;
  const percent = Math.min(100, Math.round((profile.todayXp / Math.max(1, profile.dailyGoalXp)) * 100));
  const goalMet = percent >= 100;

  return (
    <section className="learn-strip" aria-label="Your learning today">
      <Link to="/learn" className={`ls-card ls-card--streak${alive ? ' is-hot' : ''}`}>
        <span className="ls-card__icon">
          <Icon name="flame" size={24} filled />
        </span>
        <span className="ls-card__body">
          <span className="ls-card__value">
            {alive ? profile.streak : 0} <small>day streak</small>
          </span>
          <span className="ls-card__hint">
            {alive ? (activeToday ? 'Done for today' : 'Practise today to keep it') : 'Practise today to start one'}
          </span>
        </span>
      </Link>

      <Link to="/learn" className={`ls-card ls-card--xp${goalMet ? ' is-met' : ''}`}>
        <span className="ls-card__icon">
          <Icon name={goalMet ? 'check' : 'bolt'} size={24} filled={!goalMet} strokeWidth={goalMet ? 3 : 1.7} />
        </span>
        <span className="ls-card__body">
          <span className="ls-card__value">
            {profile.todayXp}/{profile.dailyGoalXp} <small>XP today</small>
          </span>
          <span className="ls-card__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Daily goal">
            <i style={{ width: `${percent}%` }} />
          </span>
        </span>
      </Link>

      <Link to={data.dueWords > 0 ? '/learn/review' : '/learn'} className="ls-card ls-card--review">
        <span className="ls-card__icon">
          <Icon name="layers" size={24} />
        </span>
        <span className="ls-card__body">
          <span className="ls-card__value">
            {data.dueWords} <small>word{data.dueWords === 1 ? '' : 's'} to review</small>
          </span>
          <span className="ls-card__hint ls-card__hint--link">
            {data.dueWords > 0 ? 'Review now' : 'All caught up'}
            {data.dueWords > 0 ? <Icon name="arrowRight" size={13} strokeWidth={2.4} /> : null}
          </span>
        </span>
      </Link>
    </section>
  );
}
