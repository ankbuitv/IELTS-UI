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
import { Icon } from '../../components/Icon';
import { Button, Loading, Notice } from '../../components/ui';
import { Mascot } from '../../components/learn/Mascot';
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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

function Row({ row, scope }: { row: LeaderboardRow; scope: LeaderboardScope }) {
  const medal = row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : null;
  return (
    <li className={`board__row${row.isMe ? ' is-me' : ''}${row.rank <= 3 ? ' is-top' : ''}`}>
      <span className="board__rank">{medal ?? row.rank}</span>
      <span className={`board__avatar board__avatar--${scope}`} aria-hidden="true">
        {initialsOf(row.name)}
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

  const data = board.data;
  const podium = data?.rows.slice(0, 3) ?? [];

  return (
    <div className="board">
      <header className="board__hero">
        <Mascot mood="wow" size={116} />
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
              <div>
                <p className="board__me-rank">
                  Your rank <b>#{data.me.rank}</b>
                </p>
                <p className="muted small">
                  {data.me.valueLabel} · {data.me.secondary}
                </p>
              </div>
              <div className="board__me-hint">
                {data.total > LEADERBOARD_LIMIT ? (
                  <span className="muted tiny">
                    {data.total} learners are on this board — the list shows the first {LEADERBOARD_LIMIT}.
                  </span>
                ) : (
                  <span className="muted tiny">
                    {data.total === 1 ? 'You are the only one on this board so far.' : `${data.total} learners on this board.`}
                  </span>
                )}
                <Button size="sm" variant="ghost" onClick={() => void board.reload()}>
                  <Icon name="rotate" size={13} /> Refresh
                </Button>
              </div>
            </section>
          ) : (
            <Notice tone="info" title="You are not on this board yet">
              {scope === 'learn'
                ? 'Finish one lesson this week and you will appear here with an XP total.'
                : 'Submit a practice test and you will appear here with your test count.'}
              <div className="row" style={{ marginTop: 8 }}>
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
                    {['🥇', '🥈', '🥉'][row.rank - 1]}
                  </span>
                  <span className="podium__avatar" aria-hidden="true">
                    {initialsOf(row.name)}
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
