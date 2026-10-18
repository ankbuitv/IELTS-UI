import type { ReactNode } from 'react';
import { Icon } from '../Icon';
import { initials } from '../../lib/format';
import type { MentorSessionStatus, MentorSpecialty } from '@shared/mentor';
import { MENTOR_SPECIALTY_LABELS, MENTOR_SESSION_STATUS_LABELS } from '@shared/mentor';

/** Colour ring avatars used across the mentor pages (no photos needed). */
export function MentorAvatar({
  name,
  size = 'md',
  tone = 'violet',
  badge,
  online,
}: {
  name: string;
  size?: 'md' | 'lg';
  tone?: 'violet' | 'sun' | 'coral';
  badge?: ReactNode;
  online?: boolean;
}) {
  return (
    <span
      className={[
        'avatar-ring',
        tone === 'sun' ? 'avatar-ring--sun' : '',
        tone === 'coral' ? 'avatar-ring--coral' : '',
        size === 'lg' ? 'avatar-ring--lg' : '',
        online ? 'avatar-ring--online' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      {initials(name)}
      {badge ? <span className="avatar-ring__badge">{badge}</span> : null}
    </span>
  );
}

export function StarRating({ value, count }: { value: number; count?: number }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="stars" aria-label={`${value} out of 5`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Icon key={star} name="star" size={15} filled={star <= rounded} />
        ))}
      </span>
      <b style={{ fontSize: '0.86rem' }}>{value.toFixed(1)}</b>
      {count !== undefined ? <span className="tiny muted">({count.toLocaleString('en')})</span> : null}
    </span>
  );
}

const TONE_BY_SPECIALTY: Record<MentorSpecialty, string> = {
  SPEAKING: 'mchip--violet',
  WRITING: 'mchip--sun',
  READING: 'mchip--sky',
  LISTENING: 'mchip--mint',
  VOCABULARY: 'mchip--coral',
  GRAMMAR: 'mchip--sun',
  INTERVIEW: 'mchip--sky',
  BAND_7_PLUS: 'mchip--solid',
};

export function SpecialtyChip({ specialty }: { specialty: MentorSpecialty }) {
  return <span className={`mchip ${TONE_BY_SPECIALTY[specialty]}`}>{MENTOR_SPECIALTY_LABELS[specialty]}</span>;
}

const STATUS_TONE: Record<MentorSessionStatus, string> = {
  SCHEDULED: 'mchip--violet',
  ACTIVE: 'mchip--mint',
  COMPLETED: 'mchip',
  CANCELLED: 'mchip--coral',
  NO_SHOW: 'mchip--sun',
};

export function SessionStatusChip({ status }: { status: MentorSessionStatus }) {
  return <span className={`mchip ${STATUS_TONE[status]}`}>{MENTOR_SESSION_STATUS_LABELS[status]}</span>;
}

/** e.g. "Mon 21 Oct · 19:30" — stable English formatting across the mentor pages. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Minutes a session lasts. */
export function durationMinutes(startsAt: string, endsAt: string): number {
  return Math.max(1, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000));
}

/** "Join" opens 10 minutes before start and stays open while the room runs. */
export function canJoinNow(startsAt: string, endsAt: string, status: MentorSessionStatus): boolean {
  if (status === 'CANCELLED' || status === 'COMPLETED' || status === 'NO_SHOW') return false;
  const now = Date.now();
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  return now >= start - 10 * 60_000 && now <= end + 15 * 60_000;
}
