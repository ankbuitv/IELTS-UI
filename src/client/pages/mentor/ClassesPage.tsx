import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { mentorApi } from '../../lib/mentor-api';
import { describeError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button, EmptyState, Loading, Notice, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { MentorAvatar, formatWhen } from '../../components/mentor/MentorBits';
import type { MentorClass } from '@shared/mentor';

/**
 * Live classes — small mentor-led clubs ("Rising Speakers Club" style): a
 * banner card per class, seats left, join/leave, and one room for the call.
 */
export function ClassesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const classes = useAsync(() => mentorApi.classes(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const list = classes.data?.classes ?? [];
  const mine = list.filter((item) => item.joined || item.mentorId === user?.id);
  const discover = list.filter((item) => !mine.includes(item));

  const join = async (item: MentorClass) => {
    setBusy(item.id);
    setError(null);
    try {
      await mentorApi.joinClass(item.id);
      toast.push(`You joined “${item.title}”.`, 'success');
      await classes.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  };

  const leave = async (item: MentorClass) => {
    if (!window.confirm(`Leave “${item.title}”?`)) return;
    setBusy(item.id);
    setError(null);
    try {
      await mentorApi.leaveClass(item.id);
      await classes.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  };

  const renderCard = (item: MentorClass) => {
    const full = item.memberCount >= item.capacity && !item.joined;
    const now = new Date().getTime();
    const started = new Date(item.startsAt).getTime() <= now && new Date(item.endsAt).getTime() >= now;
    return (
      <article key={item.id} className="class-card">
        <div className="class-card__banner">
          <h3>{item.title}</h3>
          <p>
            {item.level} · led by {item.mentorName}
          </p>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {item.description || 'A live practice class with a mentor.'}
        </p>
        <div className="class-card__meta">
          <span className="mchip mchip--violet">
            <Icon name="calendar" size={12} />
            {formatWhen(item.startsAt)}
          </span>
          {item.recurrence ? (
            <span className="mchip mchip--sun">
              <Icon name="rotate" size={12} />
              {item.recurrence}
            </span>
          ) : null}
          <span className="mchip">{item.priceCoins > 0 ? `${item.priceCoins} coins` : 'Free'}</span>
        </div>
        <div className="class-card__seats">
          <Icon name="users" size={15} />
          <span>
            {item.memberCount}/{item.capacity} seats
          </span>
          <span className="bar" aria-hidden="true">
            <span className="bar__track" style={{ display: 'block', height: 6, borderRadius: 999, background: 'var(--ink-100)', overflow: 'hidden' }}>
              <span
                style={{
                  display: 'block',
                  height: '100%',
                  width: `${Math.min(100, Math.round((item.memberCount / item.capacity) * 100))}%`,
                  background: 'var(--brand-500)',
                  borderRadius: 999,
                }}
              />
            </span>
          </span>
        </div>
        <div className="row" style={{ marginTop: 'auto' }}>
          {item.mentorId === user?.id ? (
            <>
              <Button variant="secondary" onClick={() => navigate('/mentor')}>
                <Icon name="settings" size={14} />
                Manage
              </Button>
              {started ? (
                <Button variant="primary" onClick={() => navigate('/mentor')}>
                  <Icon name="video" size={14} />
                  Open room
                </Button>
              ) : null}
            </>
          ) : item.joined ? (
            <>
              {started ? (
                <Button variant="primary" onClick={() => navigate('/my-sessions')}>
                  <Icon name="video" size={14} />
                  Go to sessions
                </Button>
              ) : (
                <Button variant="success" disabled>
                  <Icon name="check" size={14} />
                  Joined
                </Button>
              )}
              <Button variant="ghost" loading={busy === item.id} onClick={() => leave(item)}>
                Leave
              </Button>
            </>
          ) : (
            <Button variant="primary" loading={busy === item.id} disabled={full || item.status !== 'OPEN'} onClick={() => join(item)}>
              <Icon name="plus" size={14} />
              {full ? 'Class full' : 'Join class'}
            </Button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="stack">
      <section className="mentor-hero">
        <div className="mentor-hero__text">
          <span className="mentor-hero__eyebrow">
            <Icon name="users" size={14} />
            Live classes
          </span>
          <h1>Practice together, led by a mentor</h1>
          <p>
            Small live classes where everyone speaks. Join a club, meet weekly and build the confidence a solo app
            cannot give you.
          </p>
          <div className="mentor-hero__actions">
            <Button variant="sun" onClick={() => navigate('/mentors')}>
              Find a mentor
            </Button>
            {user?.role === 'MENTOR' || user?.role === 'ADMIN' ? (
              <Button variant="glass" onClick={() => navigate('/mentor')}>
                <Icon name="plus" size={14} />
                Open a class
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mentor-hero__stats">
          <div className="mentor-hero__stat">
            <b>{list.length}</b>
            <span>Classes</span>
          </div>
          <div className="mentor-hero__stat">
            <b>{mine.length}</b>
            <span>Joined</span>
          </div>
        </div>
      </section>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {classes.loading && list.length === 0 ? <Loading label="Loading classes…" /> : null}

      {mine.length > 0 ? (
        <section className="stack">
          <h2 style={{ fontSize: '1.15rem' }}>Your classes</h2>
          <div className="mentor-grid">{mine.map(renderCard)}</div>
        </section>
      ) : null}

      <section className="stack">
        <h2 style={{ fontSize: '1.15rem' }}>Discover</h2>
        {discover.length === 0 && !classes.loading ? (
          <EmptyState title="No open classes right now">
            Check back soon, or book a 1-on-1 session with a mentor instead.
          </EmptyState>
        ) : (
          <div className="mentor-grid">{discover.map(renderCard)}</div>
        )}
      </section>

      <section className="stack">
        <h2 style={{ fontSize: '1.15rem' }}>Your mentors</h2>
        <div className="row">
          <div className="session-card" style={{ flex: 1 }}>
            <MentorAvatar name="Aieo Coaching" tone="sun" />
            <div className="session-card__body">
              <h3>Not sure where to start?</h3>
              <p>Browse the mentor directory — filter by specialty, read reviews and book a free first plan.</p>
            </div>
            <Button variant="primary" onClick={() => navigate('/mentors')}>
              Browse mentors
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
