import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { mentorApi } from '../../lib/mentor-api';
import { describeError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button, Field, Loading, Modal, Notice, TextArea, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import {
  SessionStatusChip,
  canJoinNow,
  formatWhen,
} from '../../components/mentor/MentorBits';
import type { MentorSession } from '@shared/mentor';

/**
 * My sessions — every booked coaching call, soonest first: join the live room,
 * cancel ahead of time, or review a finished session.
 */
export function MySessionsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const sessions = useAsync(() => mentorApi.sessions('all'), []);
  const [error, setError] = useState<string | null>(null);
  const [reviewFor, setReviewFor] = useState<MentorSession | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const all = sessions.data?.sessions ?? [];
  const now = new Date().getTime();
  const upcoming = all.filter(
    (session) =>
      (session.status === 'SCHEDULED' || session.status === 'ACTIVE') &&
      new Date(session.endsAt).getTime() >= now,
  );
  const past = all.filter((session) => !upcoming.includes(session));

  const cancel = async (session: MentorSession) => {
    if (!window.confirm('Cancel this session? Any coins paid are refunded.')) return;
    setBusy(true);
    setError(null);
    try {
      await mentorApi.cancel(session.id);
      toast.push('Session cancelled.', 'success');
      await sessions.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const sendReview = async () => {
    if (!reviewFor) return;
    setBusy(true);
    setError(null);
    try {
      await mentorApi.review(reviewFor.id, rating, comment);
      toast.push('Thanks for your review!', 'success');
      setReviewFor(null);
      setComment('');
      await sessions.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const isMentorSide = user?.role === 'MENTOR';

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{isMentorSide ? 'Your coaching sessions' : 'My mentor sessions'}</h1>
          <p className="page-head__meta">
            {isMentorSide
              ? 'Every booked call with a student. Open the room a few minutes early to test your camera.'
              : 'Your booked mentor calls. Join the live room when it opens — camera and microphone on arrival.'}
          </p>
        </div>
        {!isMentorSide ? (
          <Button variant="primary" onClick={() => navigate('/mentors')}>
            <Icon name="plus" size={14} />
            Book a session
          </Button>
        ) : null}
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {sessions.loading && all.length === 0 ? <Loading label="Loading your sessions…" /> : null}

      <section className="stack">
        <h2 style={{ fontSize: '1.15rem' }}>Up next</h2>
        {upcoming.length === 0 ? (
          <div className="mentor-empty">
            <h3>Nothing booked yet</h3>
            <p className="small" style={{ margin: '0 0 14px' }}>
              {isMentorSide
                ? 'Students will appear here when they book a slot with you.'
                : 'Find a mentor and book your first live coaching call.'}
            </p>
            {!isMentorSide ? (
              <Link to="/mentors" className="btn btn--primary">
                <Icon name="graduation" size={14} />
                Browse mentors
              </Link>
            ) : null}
          </div>
        ) : (
          upcoming.map((session) => {
            const joinable = canJoinNow(session.startsAt, session.endsAt, session.status);
            const counterpart = isMentorSide ? session.studentName : session.mentorName;
            return (
              <article key={session.id} className={`session-card${joinable ? ' session-card--live' : ''}`}>
                <div className={`session-card__when${joinable ? ' session-card__when--live' : ''}`}>
                  <b>{new Date(session.startsAt).getDate()}</b>
                  <span>{new Date(session.startsAt).toLocaleDateString('en', { month: 'short' })}</span>
                </div>
                <div className="session-card__body">
                  <h3>
                    {session.topic} {session.kind === 'CLASS' && session.className ? <span className="mchip mchip--sun">{session.className}</span> : null}
                  </h3>
                  <p>
                    {formatWhen(session.startsAt)} · with {counterpart}
                    {session.paidCoins > 0 ? ` · ${session.paidCoins} coins` : ''}
                  </p>
                  <div style={{ marginTop: 8 }}>
                    <SessionStatusChip status={session.status} />
                  </div>
                </div>
                <div className="session-card__actions">
                  {joinable ? (
                    <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}/room`)}>
                      <Icon name="video" size={14} />
                      Join call
                    </Button>
                  ) : (
                    <Button variant="ghost" disabled>
                      <Icon name="clock" size={14} />
                      Opens 10 min before
                    </Button>
                  )}
                  <Button variant="danger" disabled={busy || session.status !== 'SCHEDULED'} onClick={() => cancel(session)}>
                    Cancel
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </section>

      <section className="stack">
        <h2 style={{ fontSize: '1.15rem' }}>Earlier sessions</h2>
        {past.length === 0 ? (
          <p className="muted small">Your finished sessions will show up here.</p>
        ) : (
          past.map((session) => (
            <article key={session.id} className="session-card">
              <div className="session-card__when" style={{ background: 'var(--ink-100)', color: 'var(--ink-600)' }}>
                <b>{new Date(session.startsAt).getDate()}</b>
                <span>{new Date(session.startsAt).toLocaleDateString('en', { month: 'short' })}</span>
              </div>
              <div className="session-card__body">
                <h3>{session.topic}</h3>
                <p>
                  {formatWhen(session.startsAt)} · with {isMentorSide ? session.studentName : session.mentorName}
                </p>
                <div className="row" style={{ marginTop: 8, gap: 8 }}>
                  <SessionStatusChip status={session.status} />
                  {session.studentRating ? (
                    <span className="mchip mchip--sun">
                      <Icon name="star" size={12} filled /> {session.studentRating}/5
                    </span>
                  ) : null}
                </div>
                {session.mentorFeedback ? (
                  <p className="small muted" style={{ marginTop: 8 }}>
                    Mentor feedback: {session.mentorFeedback}
                  </p>
                ) : null}
              </div>
              <div className="session-card__actions">
                {!isMentorSide && session.status === 'COMPLETED' && session.studentRating === null ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setReviewFor(session);
                      setRating(5);
                      setComment('');
                    }}
                  >
                    <Icon name="star" size={14} />
                    Leave a review
                  </Button>
                ) : null}
                {isMentorSide && session.status !== 'COMPLETED' && session.status !== 'CANCELLED' ? (
                  <Button
                    variant="success"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await mentorApi.complete(session.id);
                        toast.push('Session marked complete.', 'success');
                        await sessions.reload();
                      } catch (cause) {
                        setError(describeError(cause));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Icon name="check" size={14} />
                    Mark complete
                  </Button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>

      <Modal
        open={reviewFor !== null}
        title="How was the session?"
        onClose={() => setReviewFor(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setReviewFor(null)}>
              Later
            </Button>
            <Button variant="primary" loading={busy} onClick={sendReview}>
              Send review
            </Button>
          </>
        }
      >
        <Field label="Your rating">
          {() => (
            <div className="row" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${value} star`}
                  onClick={() => setRating(value)}
                  style={{
                    border: 0,
                    background: 'none',
                    cursor: 'pointer',
                    color: value <= rating ? 'var(--sun-600)' : 'var(--ink-300)',
                  }}
                >
                  <Icon name="star" size={30} filled={value <= rating} />
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Comment" hint="What worked well? What should the mentor do more of?">
          {(id) => (
            <TextArea id={id} rows={3} value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} />
          )}
        </Field>
      </Modal>
    </div>
  );
}
