/**
 * Two leaderboards.
 *
 * The Learn board is XP earned — this week, or all time — and the Practice
 * board is submitted tests, with the best band beside each row. They are
 * deliberately separate: a learner who has been working through lessons for a
 * month is not competing with somebody drilling mock papers, and mixing the two
 * would make both boards meaningless.
 *
 * The reader's own row is always shown, with its true rank, even when it falls
 * outside the fifty rows the board sends. A board you cannot find yourself on
 * is only a scoreboard; this is meant to be a race.
 *
 * Names are display names only. Nothing on this page identifies an account
 * beyond what its owner chose to be called.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LEADERBOARD_LIMIT,
  type LeaderboardResponse,
  type LeaderboardRow,
  type LeaderboardScope,
  type LeaderboardWindow,
} from '@shared/leaderboard';
import { Icon, Medal } from '../../components/Icon';
import { Button, Loading, Notice } from '../../components/ui';
import { MascotRow } from '../../components/learn/Mascot';
import { Avatar } from '../../components/Avatar';
import { useAuth } from '../../context/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { learnApi } from '../../lib/learn-api';

const SCOPES: Array<{ id: LeaderboardScope; label: string; blurb: string; icon: 'target' | 'trophy' }> = [
  { id: 'learn', label: 'Learn', blurb: 'XP earned on the path.', icon: 'target' },
  { id: 'practice', label: 'Practice', blurb: 'Tests submitted, with the best band beside them.', icon: 'trophy' },
];

const WINDOWS: Array<{ id: LeaderboardWindow; label: string }> = [
  { id: 'week', label: 'This week' },
  { id: 'all', label: 'All time' },
];

function Row({ row, scope }: { row: LeaderboardRow; scope: LeaderboardScope }) {
  return (
    <li className={`board__row${row.isMe ? ' is-me' : ''}${row.rank <= 3 ? ' is-top' : ''}`}>
      {/* A drawn medal, not 🥇: an emoji is an empty box on a device without a
          colour emoji font, and it never matched the stroke weight beside it. */}
      <span className="board__rank">{row.rank <= 3 ? <Medal rank={row.rank} size={22} /> : row.rank}</span>
      <span className={`board__avatar board__avatar--${scope}`}>
        <Avatar name={row.name} preset={row.avatar} size={36} />
      </span>
      <span className="board__who">
        <b>
          {row.name}
          {row.isMe ? <em className="board__you">you</em> : null}
        </b>
        <span>{row.secondary}</span>
      </span>
      <span className="board__value">{row.valueLabel}</span>
    </li>
  );
}

export function LeaderboardPage() {
  const [scope, setScope] = useState<LeaderboardScope>('learn');
  const [window, setWindow] = useState<LeaderboardWindow>('week');
  const board = useAsync<LeaderboardResponse>(() => learnApi.leaderboard(scope, window), [scope, window]);
  const { user, avatar } = useAuth();

  const data = board.data;
  const podium = data?.rows.slice(0, 3) ?? [];

  return (
    <div className="board">
      <header className="board__hero">
        <MascotRow variants={['gold', 'sprout', 'ocean']} mood="wow" size={72} />
        <div>
          <p className="board__kicker">Leaderboards</p>
          <h1>{scope === 'learn' ? 'Who is putting the work in' : 'Who is sitting the tests'}</h1>
          <p className="muted">
            {SCOPES.find((item) => item.id === scope)?.blurb} {window === 'week' ? 'Since Monday.' : 'Since the beginning.'}
          </p>
        </div>
      </header>

      <div className="board__controls">
        <div className="board__segmented" role="tablist" aria-label="Board">
          {SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={scope === item.id}
              className={scope === item.id ? 'is-on' : undefined}
              onClick={() => setScope(item.id)}
            >
              <Icon name={item.icon} size={14} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="board__segmented board__segmented--small" role="tablist" aria-label="Period">
          {WINDOWS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={window === item.id}
              className={window === item.id ? 'is-on' : undefined}
              onClick={() => setWindow(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {board.loading && !data ? <Loading label="Counting the board…" /> : null}
      {board.error && !data ? (
        <Notice tone="danger" title="The board could not be loaded">
          {board.error}
        </Notice>
      ) : null}

      {data ? (
        <>
          {data.me ? (
            <section className="board__me" aria-label="Your place">
              <Avatar name={data.me.name} avatar={avatar} size={54} />
              <div>
                <p className="board__me-rank">
                  Your rank <b>#{data.me.rank}</b>
                  {data.me.rank <= 3 ? <Medal rank={data.me.rank as 1 | 2 | 3} size={18} /> : null}
                </p>
                <p className="muted small">
                  {data.me.valueLabel} · {data.me.secondary}
                </p>
                {!data.meEligible ? (
                  <p className="board__me-note">
                    <Icon name="info" size={12} /> Your account is not a learner account, so this total is yours alone — it is not ranked
                    against the class list below.
                  </p>
                ) : null}
              </div>
              <div className="board__me-hint">
                {data.total > LEADERBOARD_LIMIT ? (
                  <span className="muted tiny">
                    {data.total} learners are on this board — the list shows the first {LEADERBOARD_LIMIT}.
                  </span>
                ) : (
                  <span className="muted tiny">{data.total} learners on this board.</span>
                )}
                <Button size="sm" variant="ghost" onClick={() => void board.reload()}>
                  <Icon name="rotate" size={13} /> Refresh
                </Button>
              </div>
            </section>
          ) : (
            <Notice
              tone="info"
              title={
                !data.meEligible
                  ? 'This board ranks learner accounts'
                  : data.meAllTime
                    ? 'Nothing on this board this week yet'
                    : 'You are not on this board yet'
              }
            >
              {!data.meEligible ? (
                /* The third case, and the one that used to read as a bug: a
                   teacher or an administrator has no row here *by design*, not
                   because nothing was recorded. Saying "you are not on this board
                   yet — finish a lesson" to somebody who can never be on it is
                   the message that made the board look broken. */
                <>
                  Your account is a {user?.role === 'ADMIN' ? 'administrator' : 'teacher'} account, so it is kept off
                  the class list below — that board belongs to the learners. {data.total > 0
                    ? `${data.total} learner${data.total === 1 ? ' has' : 's have'} a total in this window.`
                    : 'Nobody has a total in this window yet.'}{' '}
                  You can still work the path yourself; your XP is tracked, it just is not ranked against the class.
                </>
              ) : data.meAllTime ? (
                <>
                  You have <b>{data.meAllTime.valueLabel}</b> in total — none of it inside this window. Switch to “All time” to see it, or{' '}
                  {scope === 'learn' ? 'finish a lesson' : 'submit a test'} today and this week fills in.
                </>
              ) : scope === 'learn' ? (
                'Finish one lesson this week and you will appear here with an XP total.'
              ) : (
                'Submit a practice test and you will appear here with your test count.'
              )}
              <div className="row board__me-actions">
                {data.meEligible && data.meAllTime && window === 'week' ? (
                  <Button size="sm" onClick={() => setWindow('all')}>
                    <Icon name="clock" size={13} /> See all time
                  </Button>
                ) : null}
                <Link className="btn btn--sm btn--primary" to={scope === 'learn' ? '/learn' : '/practice'}>
                  {scope === 'learn' ? 'Open the path' : 'Start a test'}
                </Link>
              </div>
            </Notice>
          )}

          {podium.length === 3 ? (
            <ol className="board__podium" aria-label="Top three">
              {[podium[1]!, podium[0]!, podium[2]!].map((row) => (
                <li key={row.rank} className={`podium podium--${row.rank}`}>
                  <span className="podium__medal" aria-hidden="true">
                    <Medal rank={row.rank as 1 | 2 | 3} size={row.rank === 1 ? 40 : 32} />
                  </span>
                  <span className="podium__avatar">
                    <Avatar name={row.name} preset={row.avatar} avatar={row.isMe ? avatar : null} size={row.rank === 1 ? 62 : 50} />
                  </span>
                  <b>{row.name}</b>
                  <span className="podium__value">{row.valueLabel}</span>
                  <span className="podium__secondary">{row.secondary}</span>
                </li>
              ))}
            </ol>
          ) : null}

          {data.rows.length > 0 ? (
            <ol className="board__list">
              {data.rows.map((row) => (
                <Row key={`${row.rank}-${row.name}`} row={row} scope={scope} />
              ))}
            </ol>
          ) : (
            <Notice tone="info" title="Nobody is on this board yet">
              Be the first — {scope === 'learn' ? 'finish a lesson' : 'submit a test'} and your name goes on top.
            </Notice>
          )}
        </>
      ) : null}
    </div>
  );
}
