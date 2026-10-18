import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { mentorApi } from '../../lib/mentor-api';
import { describeError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, Field, Loading, Modal, Notice, TextArea, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { MentorAvatar, SpecialtyChip, StarRating, formatWhen } from '../../components/mentor/MentorBits';
import { formatMinuteOfDay, type MentorProfileDetail } from '@shared/mentor';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Build the next 14 days of bookable slots from the mentor's weekly windows. */
function buildSlots(mentor: MentorProfileDetail): Map<string, string[]> {
  const byDay = new Map<string, string[]>();
  const today = new Date();
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    const key = date.toISOString().slice(0, 10);
    const windows = mentor.availability.filter((slot) => slot.weekday === date.getDay());
    const times: string[] = [];
    for (const window of windows) {
      for (let minute = window.startMinute; minute + 30 <= window.endMinute; minute += 30) {
        const slotDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minute / 60), minute % 60);
        if (slotDate.getTime() > Date.now() + 30 * 60_000) times.push(`${key}T${formatMinuteOfDay(minute)}`);
      }
    }
    if (times.length > 0) byDay.set(key, times);
  }
  return byDay;
}

/** Profile + booking: who the mentor is, what they teach, when you can meet. */
export function MentorProfilePage() {
  const { mentorId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const detail = useAsync(() => mentorApi.profile(mentorId), [mentorId]);

  const mentor = detail.data?.mentor;
  const reviews = detail.data?.reviews ?? [];
  const slots = useMemo(() => (mentor ? buildSlots(mentor) : new Map<string, string[]>()), [mentor]);
  const dayKeys = [...slots.keys()];

  const { user } = useAuth();
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [duration, setDuration] = useState(60);
  const [customWhen, setCustomWhen] = useState('');
  const [topic, setTopic] = useState('');
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBook, setShowBook] = useState(false);

  // A mentor must not book themselves, and only students/admins book at all.
  const isSelf = Boolean(user && mentorId && user.id === mentorId);
  const canBook = Boolean(user && !isSelf && (user.role === 'STUDENT' || user.role === 'ADMIN'));

  const activeDay = day ?? dayKeys[0] ?? null;
  const times = activeDay ? (slots.get(activeDay) ?? []) : [];

  const book = async () => {
    if (!picked) return;
    setBooking(true);
    setError(null);
    try {
      const startsAt = new Date(picked).toISOString();
      const result = await mentorApi.book(mentorId, {
        startsAt,
        durationMinutes: duration,
        topic: topic.trim() || 'Coaching session',
      });
      toast.push('Session booked — see you in My sessions.', 'success');
      navigate('/my-sessions', { state: { justBooked: result.session.id } });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBooking(false);
    }
  };

  if (detail.loading && !mentor) return <Loading label="Opening the mentor profile…" />;
  if (!mentor) {
    return (
      <Notice tone="danger" title="Mentor not found">
        This mentor profile is no longer available. Back to the directory.
      </Notice>
    );
  }

  return (
    <div className="stack">
      <section className="mentor-profile-cover">
        <MentorAvatar name={mentor.displayName} size="lg" badge={mentor.verified ? <Icon name="check" size={16} /> : undefined} />
        <div>
          <h1>{mentor.displayName}</h1>
          <p>{mentor.headline || 'IELTS mentor'}</p>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="mchip mchip--sun">
              <Icon name="sparkle" size={13} />
              Verified mentor
            </span>
            {mentor.specialties.map((item) => (
              <SpecialtyChip key={item} specialty={item} />
            ))}
          </div>
        </div>
        <div className="mentor-profile-stats">
          <div className="mentor-hero__stat">
            <b>{mentor.ratingAvg.toFixed(1)}</b>
            <span>Rating</span>
          </div>
          <div className="mentor-hero__stat">
            <b>{mentor.studentsCount}</b>
            <span>Students</span>
          </div>
          <div className="mentor-hero__stat">
            <b>{mentor.sessionsCount}</b>
            <span>Sessions</span>
          </div>
          <div className="mentor-hero__stat">
            <b>{mentor.yearsExperience}+</b>
            <span>Years</span>
          </div>
        </div>
      </section>

      <div className="two-col">
        <div className="stack">
          <Card title="About this mentor">
            <p style={{ margin: 0, lineHeight: 1.7, color: 'var(--ink-700)' }}>{mentor.bio || 'No bio yet.'}</p>
            {mentor.languages.length > 0 ? (
              <div className="row" style={{ marginTop: 14 }}>
                <span className="mchip">
                  <Icon name="globe" size={13} />
                  Speaks {mentor.languages.join(', ')}
                </span>
                <span className="mchip mchip--sun">
                  <Icon name="coin" size={13} />
                  {mentor.hourlyRateCoins > 0 ? `${mentor.hourlyRateCoins} coins / hour` : 'Free during beta'}
                </span>
              </div>
            ) : null}
          </Card>

          <Card title="What students say" hint={`${reviews.length} reviews`}>
            {reviews.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                No reviews yet — be the first to book this mentor.
              </p>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                {reviews.map((review) => (
                  <div key={review.id} className="review-item">
                    <div className="review-item__head">
                      <MentorAvatar name={review.studentName} tone="coral" />
                      <div>
                        <strong>{review.studentName}</strong>
                        <StarRating value={review.rating} />
                      </div>
                      <span className="tiny muted" style={{ marginLeft: 'auto' }}>
                        {formatWhen(review.createdAt)}
                      </span>
                    </div>
                    {review.comment ? <p>{review.comment}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card
          title={canBook ? 'Book a session' : isSelf ? 'This is your profile' : 'Booking'}
          hint={
            canBook
              ? 'Pick a suggested slot or choose any time that suits you.'
              : isSelf
                ? 'You cannot book a session with yourself — this is how students see your page.'
                : 'Only student accounts can book mentor sessions.'
          }
        >
          {!canBook ? (
            <div className="mentor-empty">
              <Icon name="lock" size={22} />
              <h3>{isSelf ? 'Preview mode' : 'Booking closed for this account'}</h3>
              <p className="small" style={{ margin: 0 }}>
                {isSelf
                  ? 'Share your profile link with students so they can book time with you.'
                  : 'Sign in with a student account to book this mentor.'}
              </p>
            </div>
          ) : (
          <div className="slot-picker">
            {dayKeys.length === 0 ? (
              <div className="mentor-empty">
                <h3>No open slots right now</h3>
                <p className="small" style={{ margin: 0 }}>
                  This mentor is updating their schedule. Check back soon.
                </p>
              </div>
            ) : (
              <>
                <div className="slot-days" role="tablist" aria-label="Pick a day">
                  {dayKeys.map((key) => {
                    const date = new Date(`${key}T12:00:00`);
                    return (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={activeDay === key}
                        className={`slot-day${activeDay === key ? ' active' : ''}`}
                        onClick={() => {
                          setDay(key);
                          setPicked(null);
                        }}
                      >
                        <small>{DAY_NAMES[date.getDay()]}</small>
                        <b>{date.getDate()}</b>
                      </button>
                    );
                  })}
                </div>
                <div className="slot-times">
                  {times.map((iso) => {
                    const time = iso.slice(11);
                    return (
                      <button
                        key={iso}
                        type="button"
                        className={`slot-time${picked === iso ? ' active' : ''}`}
                        onClick={() => {
                          setPicked(iso);
                          setShowBook(true);
                        }}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
                <p className="tiny muted" style={{ margin: '6px 2px 0' }}>
                  Times are shown in your local time zone. Sessions run over a live video call.
                </p>
              </>
            )}

            <div className="slot-custom">
              <div className="slot-custom__head">
                <Icon name="clock" size={13} />
                Or pick any date & time
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="datetime-local"
                  className="answer-input"
                  aria-label="Custom date and time"
                  value={customWhen}
                  onChange={(event) => {
                    setCustomWhen(event.target.value);
                    if (event.target.value) {
                      setPicked(event.target.value);
                      setShowBook(true);
                    }
                  }}
                />
                <select
                  className="answer-input"
                  aria-label="Duration"
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                  style={{ maxWidth: 140 }}
                >
                  {[30, 45, 60, 90, 120].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          )}
        </Card>
      </div>

      <Modal
        open={showBook && picked !== null}
        title="Confirm your session"
        onClose={() => setShowBook(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowBook(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={booking} onClick={book}>
              <Icon name="calendar" size={14} />
              Book this slot
            </Button>
          </>
        }
      >
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="row" style={{ marginBottom: 14 }}>
          <MentorAvatar name={mentor.displayName} />
          <div>
            <strong>{mentor.displayName}</strong>
            <div className="small muted">
              {picked ? formatWhen(new Date(picked).toISOString()) : ''} · {duration} min
            </div>
          </div>
        </div>
        <Field label="What do you want to work on?" hint="e.g. Speaking part 2 fluency, or feedback on two task 2 essays">
          {(id) => (
            <TextArea id={id} rows={3} value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={160} />
          )}
        </Field>
        <p className="tiny muted" style={{ margin: 0 }}>
          {mentor.hourlyRateCoins > 0
            ? `This slot costs ${mentor.hourlyRateCoins} coins from your Learn wallet when you have enough; otherwise it books free during beta. Cancel any time before the session for a full refund.`
            : 'Free during beta. Cancel any time before the session.'}
        </p>
      </Modal>
    </div>
  );
}
