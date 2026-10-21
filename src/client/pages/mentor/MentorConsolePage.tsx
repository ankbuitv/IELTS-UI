import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { mentorApi } from '../../lib/mentor-api';
import { describeError } from '../../lib/api';
import { Button, Card, Field, Loading, Modal, Notice, TextArea, TextInput, useToast } from '../../components/ui';
import { CreateClassModal } from '../../components/mentor/CreateClassModal';
import { Icon } from '../../components/Icon';
import {
  MentorAvatar,
  SessionStatusChip,
  canJoinNow,
  formatClock,
  formatDay,
} from '../../components/mentor/MentorBits';
import { MENTOR_SPECIALTIES, MENTOR_SPECIALTY_LABELS, formatMinuteOfDay } from '@shared/mentor';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Mentor console — the mentor's home: today at a glance, quick actions
 * (open a class, set availability, polish the profile) and the student roster.
 */
export function MentorConsolePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const consoleData = useAsync(() => mentorApi.console(), []);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'class' | 'availability' | 'profile' | null>(null);
  const [busy, setBusy] = useState(false);

  const data = consoleData.data;
  const stats = data?.stats;

  const openRoom = (sessionId: string) => navigate(`/sessions/${sessionId}/room`);

  return (
    <div className="stack">
      <section className="mentor-hero">
        <div className="mentor-hero__text">
          <span className="mentor-hero__eyebrow">
            <Icon name="presentation" size={14} />
            Mentor console
          </span>
          <h1>Ready to coach today?</h1>
          <p>
            Your sessions, your students and your classes in one place. Open the room early, share the notes and make
            every hour count.
          </p>
          <div className="mentor-hero__actions">
            <Button variant="sun" onClick={() => setModal('class')}>
              <Icon name="plus" size={14} />
              Open a live class
            </Button>
            <Button variant="glass" onClick={() => setModal('availability')}>
              <Icon name="clock" size={14} />
              Set availability
            </Button>
            <Button variant="glass" onClick={() => setModal('profile')}>
              <Icon name="edit" size={14} />
              Edit profile
            </Button>
            <Button variant="glass" onClick={() => navigate('/mentor/earnings')}>
              <Icon name="coin" size={14} />
              Earnings
            </Button>
          </div>
        </div>
        <div className="mentor-hero__stats">
          <div className="mentor-hero__stat">
            <b>{stats?.completed ?? 0}</b>
            <span>Sessions</span>
          </div>
          <div className="mentor-hero__stat">
            <b>{stats?.ratingAvg?.toFixed(1) ?? '—'}</b>
            <span>Rating</span>
          </div>
          <div className="mentor-hero__stat">
            <b>{data?.profile?.studentsCount ?? 0}</b>
            <span>Students</span>
          </div>
          <div className="mentor-hero__stat">
            <b>{stats?.coinsEarned ?? 0}</b>
            <span>Coins</span>
          </div>
        </div>
      </section>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="console-grid">
        <div className="console-tile">
          <div className="console-tile__icon">
            <Icon name="video" size={20} />
          </div>
          <b>{(data?.upcoming ?? []).filter((session) => canJoinNow(session.startsAt, session.endsAt, session.status)).length}</b>
          <span>Live right now</span>
        </div>
        <div className="console-tile console-tile--sun">
          <div className="console-tile__icon">
            <Icon name="calendar" size={20} />
          </div>
          <b>{data?.upcoming?.length ?? 0}</b>
          <span>Upcoming sessions</span>
        </div>
        <div className="console-tile console-tile--coral">
          <div className="console-tile__icon">
            <Icon name="coin" size={20} />
          </div>
          <b>{stats?.coinsEarned ?? 0}</b>
          <span>Coins earned</span>
        </div>
        <div className="console-tile console-tile--mint">
          <div className="console-tile__icon">
            <Icon name="star" size={20} />
          </div>
          <b>{stats?.ratingCount ?? 0}</b>
          <span>Reviews received</span>
        </div>
      </div>

      <div className="two-col">
        <Card title="Upcoming sessions" hint="Open a room to start the call">
          {consoleData.loading && !data ? (
            <Loading label="Loading your schedule…" />
          ) : (data?.upcoming ?? []).length === 0 ? (
            <div className="mentor-empty">
              <h3>Your schedule is clear</h3>
              <p className="small" style={{ margin: 0 }}>
                Share your profile with students or open a live class to fill the week.
              </p>
            </div>
          ) : (
            <div className="day-schedule">
              {(data?.upcoming ?? []).map((session) => {
                const joinable = canJoinNow(session.startsAt, session.endsAt, session.status);
                return (
                  <div
                    key={session.id}
                    className={`day-slot${session.kind === 'CLASS' ? ' day-slot--class' : ''}`}
                  >
                    <div className="day-slot__time">
                      {formatClock(session.startsAt)}
                      <div className="tiny muted" style={{ fontWeight: 600 }}>
                        {formatDay(session.startsAt)}
                      </div>
                    </div>
                    <div className="day-slot__body">
                      <strong>{session.topic}</strong>
                      <span>
                        {session.kind === 'CLASS' ? 'Class · ' : '1-on-1 · '}
                        {session.studentName}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <SessionStatusChip status={session.status} />
                      <Button
                        size="sm"
                        variant={joinable ? 'primary' : 'ghost'}
                        onClick={() => openRoom(session.id)}
                        disabled={session.status === 'CANCELLED'}
                      >
                        <Icon name="video" size={13} />
                        {joinable ? 'Open room' : 'View'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Your students" hint="People who booked time with you">
          {(data?.students ?? []).length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              Students appear here after their first booked session.
            </p>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {(data?.students ?? []).map((student) => (
                <div key={student.id} className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                  <MentorAvatar name={student.displayName} tone="sun" />
                  <div style={{ minWidth: 0 }}>
                    <strong className="small" style={{ display: 'block', color: 'var(--ink-950)' }}>
                      {student.displayName}
                    </strong>
                    <span className="tiny muted">
                      {student.sessionsTogether} session{student.sessionsTogether === 1 ? '' : 's'} · last{' '}
                      {formatDay(student.lastSession)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {modal === 'class' ? (
        <CreateClassModal
          open
          onClose={() => setModal(null)}
          onCreated={() => {
            setModal(null);
            toast.push('Class published — students can join now.', 'success');
            navigate('/classes');
          }}
        />
      ) : null}
      {modal === 'availability' ? (
        <AvailabilityModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            toast.push('Availability saved.', 'success');
          }}
          onError={setError}
          setBusy={setBusy}
          busy={busy}
        />
      ) : null}
      {modal === 'profile' ? (
        <ProfileModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            toast.push('Profile updated.', 'success');
          }}
          onError={setError}
          setBusy={setBusy}
          busy={busy}
        />
      ) : null}
    </div>
  );
}

function AvailabilityModal({
  onClose,
  onSaved,
  onError,
  setBusy,
  busy,
}: {
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string | null) => void;
  setBusy: (busy: boolean) => void;
  busy: boolean;
}) {
  // Simple weekly template: per weekday, one window the mentor toggles on/off.
  const [windows, setWindows] = useState(
    DAY_LABELS.map((label, weekday) => ({
      label,
      weekday,
      enabled: weekday >= 1 && weekday <= 5,
      start: '17:00',
      end: '21:00',
    })),
  );

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      await mentorApi.saveAvailability(
        windows
          .filter((window) => window.enabled)
          .map((window) => ({
            weekday: window.weekday,
            startMinute: Number(window.start.slice(0, 2)) * 60 + Number(window.start.slice(3, 5)),
            endMinute: Number(window.end.slice(0, 2)) * 60 + Number(window.end.slice(3, 5)),
          })),
      );
      onSaved();
    } catch (cause) {
      onError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Weekly availability"
      onClose={onClose}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Save availability
          </Button>
        </>
      }
    >
      <p className="small muted">Students can book 60-minute calls inside these windows.</p>
      <div className="stack" style={{ gap: 8 }}>
        {windows.map((window, index) => (
          <div key={window.label} className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
            <label className="row" style={{ gap: 8, minWidth: 130, flexWrap: 'nowrap' }}>
              <input
                type="checkbox"
                checked={window.enabled}
                onChange={(event) =>
                  setWindows(
                    windows.map((item, i) => (i === index ? { ...item, enabled: event.target.checked } : item)),
                  )
                }
              />
              <strong className="small">{window.label}</strong>
            </label>
            <TextInput
              type="time"
              value={window.start}
              disabled={!window.enabled}
              onChange={(event) =>
                setWindows(windows.map((item, i) => (i === index ? { ...item, start: event.target.value } : item)))
              }
            />
            <span className="muted">→</span>
            <TextInput
              type="time"
              value={window.end}
              disabled={!window.enabled}
              onChange={(event) =>
                setWindows(windows.map((item, i) => (i === index ? { ...item, end: event.target.value } : item)))
              }
            />
          </div>
        ))}
      </div>
      <p className="tiny muted" style={{ marginTop: 12 }}>
        Saved windows are stored in UTC-minute form and shown to students in their own time zone. Example of a saved
        window: 17:00–21:00 = {formatMinuteOfDay(17 * 60)}–{formatMinuteOfDay(21 * 60)}.
      </p>
    </Modal>
  );
}

function ProfileModal({
  onClose,
  onSaved,
  onError,
  setBusy,
  busy,
}: {
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string | null) => void;
  setBusy: (busy: boolean) => void;
  busy: boolean;
}) {
  const [form, setForm] = useState({
    headline: '',
    bio: '',
    specialties: [] as string[],
    languages: 'English, Vietnamese',
    hourlyRateCoins: 0,
    yearsExperience: 3,
  });

  const toggleSpecialty = (item: string) =>
    setForm((prev) => ({
      ...prev,
      specialties: prev.specialties.includes(item)
        ? prev.specialties.filter((value) => value !== item)
        : [...prev.specialties, item],
    }));

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      await mentorApi.saveProfile({
        headline: form.headline.trim(),
        bio: form.bio.trim(),
        specialties: form.specialties,
        languages: form.languages.split(',').map((item) => item.trim()).filter(Boolean),
        hourlyRateCoins: Number(form.hourlyRateCoins),
        yearsExperience: Number(form.yearsExperience),
      });
      onSaved();
    } catch (cause) {
      onError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Your mentor profile"
      onClose={onClose}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Save profile
          </Button>
        </>
      }
    >
      <Field label="Headline" hint="One line students see first">
        {(id) => (
          <TextInput
            id={id}
            value={form.headline}
            onChange={(e) => setForm({ ...form, headline: e.target.value })}
            placeholder="e.g. Speaking coach · ex-IELTS examiner · Band 8.5"
            maxLength={140}
          />
        )}
      </Field>
      <Field label="Bio">
        {(id) => <TextArea id={id} rows={4} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />}
      </Field>
      <Field label="Specialties" hint="Pick what you coach">
        {() => (
          <div className="filter-bar">
            {MENTOR_SPECIALTIES.map((item) => (
              <button
                key={item}
                type="button"
                className={`filter-chip${form.specialties.includes(item) ? ' active' : ''}`}
                onClick={() => toggleSpecialty(item)}
              >
                {MENTOR_SPECIALTY_LABELS[item]}
              </button>
            ))}
          </div>
        )}
      </Field>
      <div className="grid grid--2">
        <Field label="Languages">
          {(id) => (
            <TextInput id={id} value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} />
          )}
        </Field>
        <Field label="Hourly rate (coins)">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={0}
              value={form.hourlyRateCoins}
              onChange={(e) => setForm({ ...form, hourlyRateCoins: Number(e.target.value) })}
            />
          )}
        </Field>
        <Field label="Years of experience">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={0}
              value={form.yearsExperience}
              onChange={(e) => setForm({ ...form, yearsExperience: Number(e.target.value) })}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
