import { ESTIMATE_DISCLAIMER } from '@shared/scoring';

export const BAND_DISCLAIMER = ESTIMATE_DISCLAIMER;

export function formatBand(band: number | null | undefined): string {
  if (band === null || band === undefined || Number.isNaN(band)) return '—';
  return Number.isInteger(band) ? `${band}.0` : band.toFixed(1);
}

export function formatScore(raw: number | null | undefined, total: number | null | undefined): string {
  if (raw === null || raw === undefined || total === null || total === undefined || total === 0) return '—';
  return `${raw} / ${total}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'Untimed';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** Countdown clock: always rendered from a server-derived remaining value. */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '--:--';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (minutes < 60) return formatter.format(Math.round(diff / 60_000), 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 36) return formatter.format(Math.round(diff / 3_600_000), 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return formatter.format(Math.round(diff / 86_400_000), 'day');
  return formatDate(iso);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export const SKILL_LABELS: Record<string, string> = {
  READING: 'Reading',
  LISTENING: 'Listening',
  WRITING: 'Writing',
};

export const TEST_TYPE_LABELS: Record<string, string> = {
  READING: 'Reading',
  LISTENING: 'Listening',
  WRITING: 'Writing',
  FULL_MOCK: 'Full mock',
};

export const MODE_LABELS: Record<string, string> = {
  PRACTICE: 'Practice',
  STANDARD_EXAM: 'Standard exam',
  STRICT_EXAM: 'Strict exam',
};

export const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  OVERDUE: 'Overdue',
};

export function statusTone(status: string): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'SUBMITTED':
      return 'success';
    case 'IN_PROGRESS':
      return 'accent';
    case 'OVERDUE':
      return 'danger';
    case 'EXPIRED':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}
