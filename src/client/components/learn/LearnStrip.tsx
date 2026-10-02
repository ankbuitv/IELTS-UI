import { Link } from 'react-router-dom';
import { streakAlive } from '@shared/learn';
import { useAsync } from '../../hooks/useAsync';
import { learnApi, localDay } from '../../lib/learn-api';
import { Icon } from '../Icon';

/**
 * One slim line on the dashboard: streak, today's XP against the goal and the
 * words due. It stays out of the way while loading and when it fails: it is a
 * convenience, never a reason for the dashboard to show an error.
 */
export function LearnStrip() {
  const { data } = useAsync(() => learnApi.overview(), []);
  if (!data) return null;
  const { profile } = data;
  const today = localDay();
  const alive = streakAlive(profile.lastActiveDay, today) && profile.streak > 0;
  const percent = Math.min(100, Math.round((profile.todayXp / Math.max(1, profile.dailyGoalXp)) * 100));
  return (
    <Link to="/learn" className="learn-strip" aria-label="Open your learning path">
      <span className={`learn-strip__item${alive ? ' is-hot' : ''}`}>
        <Icon name="zap" size={15} />
        <b>{alive ? profile.streak : 0}</b> day streak
      </span>
      <span className="learn-strip__goal">
        <span className="learn-strip__bar" aria-hidden="true">
          <i style={{ width: `${percent}%` }} />
        </span>
        <span>
          {profile.todayXp}/{profile.dailyGoalXp} XP today
        </span>
      </span>
      <span className="learn-strip__item">
        <Icon name="layers" size={15} />
        <b>{data.dueWords}</b> word{data.dueWords === 1 ? '' : 's'} to review
      </span>
      <span className="learn-strip__go">
        Learn <Icon name="arrowRight" size={13} />
      </span>
    </Link>
  );
}
