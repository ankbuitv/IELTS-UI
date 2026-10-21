import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { mentorApi } from '../../lib/mentor-api';
import { Button, EmptyState, Loading } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { MentorAvatar, SpecialtyChip, StarRating } from '../../components/mentor/MentorBits';
import { MENTOR_SPECIALTIES, MENTOR_SPECIALTY_LABELS, type MentorSpecialty } from '@shared/mentor';

/**
 * Find a mentor — the shop window of the coaching side: a colourful hero, a
 * row of specialty filters and one friendly card per coach.
 */
export function MentorDirectoryPage() {
  const navigate = useNavigate();
  const [specialty, setSpecialty] = useState<MentorSpecialty | ''>('');
  const directory = useAsync(() => mentorApi.directory(specialty), [specialty]);

  const mentors = directory.data?.mentors ?? [];

  return (
    <div className="stack">
      <section className="mentor-hero">
        <div className="mentor-hero__text">
          <span className="mentor-hero__eyebrow">
            <Icon name="graduation" size={14} />
            1-on-1 coaching
          </span>
          <h1>Meet mentors who get you to your band</h1>
          <p>
            Book a live video session with a mentor, practise speaking face to face, get essay feedback and a plan
            that fits your exam date.
          </p>
          <div className="mentor-hero__actions">
            <Button variant="sun" onClick={() => setSpecialty('SPEAKING')}>
              <Icon name="mic" size={14} />
              Find a speaking coach
            </Button>
            <Button variant="glass" onClick={() => navigate('/my-sessions')}>
              My sessions
            </Button>
          </div>
        </div>
        <div className="mentor-hero__stats">
          <div className="mentor-hero__stat">
            <b>{mentors.length || '—'}</b>
            <span>Mentors</span>
          </div>
          <div className="mentor-hero__stat">
            <b>1-on-1</b>
            <span>Live calls</span>
          </div>
          <div className="mentor-hero__stat">
            <b>Free</b>
            <span>First plan</span>
          </div>
        </div>
      </section>

      <div className="filter-bar" role="tablist" aria-label="Filter mentors by specialty">
        <button
          type="button"
          className={`filter-chip${specialty === '' ? ' active' : ''}`}
          onClick={() => setSpecialty('')}
        >
          All mentors
        </button>
        {MENTOR_SPECIALTIES.map((item) => (
          <button
            key={item}
            type="button"
            className={`filter-chip${specialty === item ? ' active' : ''}`}
            onClick={() => setSpecialty(item)}
          >
            {MENTOR_SPECIALTY_LABELS[item]}
          </button>
        ))}
      </div>

      {directory.loading && mentors.length === 0 ? <Loading label="Finding mentors…" /> : null}

      {!directory.loading && mentors.length === 0 ? (
        <EmptyState
          title="No mentors match that filter"
        >
          Try another specialty — new mentors join every week.
        </EmptyState>
      ) : (
        <div className="mentor-grid">
          {mentors.map((mentor, index) => (
            <article key={mentor.userId} className="mentor-card">
              <div className="mentor-card__top">
                <MentorAvatar
                  name={mentor.displayName}
                  tone={index % 3 === 1 ? 'sun' : index % 3 === 2 ? 'coral' : 'violet'}
                  badge={mentor.verified ? <Icon name="check" size={13} /> : undefined}
                />
                <div style={{ minWidth: 0 }}>
                  <h3 className="mentor-card__name">{mentor.displayName}</h3>
                  <p className="mentor-card__headline">{mentor.headline || 'IELTS mentor'}</p>
                </div>
              </div>

              <div className="mentor-card__tags">
                {mentor.specialties.slice(0, 3).map((item) => (
                  <SpecialtyChip key={item} specialty={item} />
                ))}
              </div>

              <StarRating value={mentor.ratingAvg} count={mentor.ratingCount} />

              <div className="mentor-card__meta">
                <span>
                  <Icon name="users" size={14} /> <b>{mentor.studentsCount}</b> students
                </span>
                <span>
                  <Icon name="clock" size={14} /> <b>{mentor.sessionsCount}</b> sessions
                </span>
                {mentor.languages.length > 0 ? (
                  <span>
                    <Icon name="globe" size={14} /> {mentor.languages.slice(0, 2).join(', ')}
                  </span>
                ) : null}
              </div>

              <div className="mentor-card__foot">
                <div className="mentor-card__price">
                  {mentor.hourlyRateCoins > 0 ? (
                    <>
                      {mentor.hourlyRateCoins} <small>coins / hour</small>
                    </>
                  ) : (
                    <>
                      Free <small>beta pricing</small>
                    </>
                  )}
                </div>
                <Link to={`/mentors/${mentor.userId}`} className="btn btn--primary">
                  View & book
                  <Icon name="arrowRight" size={14} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
