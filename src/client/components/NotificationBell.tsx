/**
 * Notification centre.
 *
 * One hook (`useNotificationFeed`) backs both the header bell and the
 * `/notifications` page. The feed refreshes on mount, every 45 seconds and
 * whenever the tab regains focus, which is enough for the events this product
 * creates (bookings, marking, announcements) without a websocket per user.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, describeError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Icon, type IconName } from './Icon';
import { Button, Card, Loading, Notice } from './ui';
import { formatDateTime } from '../lib/format';

type NotificationKind = 'SYSTEM' | 'MARKING' | 'BOOKING' | 'CLASS' | 'ASSIGNMENT' | 'ACHIEVEMENT';

interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationFeed {
  items: NotificationItem[];
  unread: number;
}

const KIND_ICON: Record<NotificationKind, IconName> = {
  SYSTEM: 'sparkle',
  MARKING: 'pen',
  BOOKING: 'calendar',
  CLASS: 'presentation',
  ASSIGNMENT: 'file',
  ACHIEVEMENT: 'award',
};

export function useNotificationFeed() {
  const { user } = useAuth();
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setFeed(await api.get<NotificationFeed>('/api/notifications'));
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
    if (!user) return undefined;
    const interval = window.setInterval(() => void reload(), 45_000);
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload, user]);

  const markRead = useCallback(async (item: NotificationItem) => {
    if (item.readAt) return;
    setFeed((current) =>
      current
        ? {
            items: current.items.map((entry) => (entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)),
            unread: Math.max(0, current.unread - 1),
          }
        : current,
    );
    try {
      await api.post(`/api/notifications/${item.id}/read`, {});
    } catch {
      // The optimistic state stays; the next poll reconciles it.
    }
  }, []);

  const markAll = useCallback(async () => {
    setFeed((current) =>
      current ? { items: current.items.map((entry) => ({ ...entry, readAt: entry.readAt ?? new Date().toISOString() })), unread: 0 } : current,
    );
    try {
      await api.post('/api/notifications/read-all', {});
    } catch {
      // Reconciled by the next poll.
    }
  }, []);

  return { feed, error, loading, reload, markRead, markAll };
}

/** "3m", "2h", "4d" — falls back to a date once it is older than a week. */
function shortAgo(iso: string, now: number): string {
  if (!now) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return formatDateTime(iso).split(',')[0] ?? '';
}

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { feed, error, markRead, markAll } = useNotificationFeed();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    setNow(Date.now());
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const unread = feed?.unread ?? 0;
  const items = feed?.items ?? [];

  const openItem = (item: NotificationItem) => {
    void markRead(item);
    setOpen(false);
    if (item.href) navigate(item.href);
  };

  return (
    <div className="notif" ref={panelRef}>
      <button
        type="button"
        className={`notif__trigger${open ? ' is-open' : ''}`}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="bell" size={18} />
        {unread > 0 ? <span className="notif__badge">{unread > 9 ? '9+' : unread}</span> : null}
      </button>

      {open ? (
        <div className="notif__panel" role="dialog" aria-label="Notifications">
          <div className="notif__head">
            <strong>Notifications</strong>
            {unread > 0 ? (
              <button type="button" className="notif__link" onClick={() => void markAll()}>
                Mark all read
              </button>
            ) : null}
          </div>

          {error ? <p className="notif__empty">{error}</p> : null}
          {!error && items.length === 0 ? (
            <p className="notif__empty">You&apos;re all caught up. Results, bookings and class news land here.</p>
          ) : null}

          <ul className="notif__list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`notif__item${item.readAt ? '' : ' is-unread'}`}
                  onClick={() => openItem(item)}
                >
                  <span className="notif__icon">
                    <Icon name={KIND_ICON[item.kind] ?? 'bell'} size={15} />
                  </span>
                  <span className="notif__text">
                    <strong>{item.title}</strong>
                    {item.body ? <span>{item.body}</span> : null}
                    <em>{shortAgo(item.createdAt, now)}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <Link to="/notifications" className="notif__all" onClick={() => setOpen(false)}>
            View all notifications
            <Icon name="arrowRight" size={13} />
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** `/notifications` — the same feed with room to breathe. */
export function NotificationsPage() {
  const { feed, error, loading, markRead, markAll } = useNotificationFeed();
  const navigate = useNavigate();
  if (loading && !feed) return <Loading label="Loading notifications…" />;
  if (error && !feed) return <Notice tone="danger">{error}</Notice>;

  const items = feed?.items ?? [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p className="page-head__meta">
            {feed?.unread ? `${feed.unread} unread` : 'Everything here is read'} · results, bookings, classes and
            announcements.
          </p>
        </div>
        {items.length > 0 ? (
          <Button size="sm" variant="secondary" onClick={() => void markAll()} disabled={!feed?.unread}>
            Mark all read
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <Card>
          <p className="muted" style={{ margin: 0 }}>
            Nothing yet. When an AI judgement finishes, a mentor confirms a session or your class posts news, it will
            appear here.
          </p>
        </Card>
      ) : (
        <Card flush>
          <ul className="notif-page">
            {items.map((item) => (
              <li key={item.id} className={item.readAt ? undefined : 'is-unread'}>
                <button
                  type="button"
                  className="notif-page__item"
                  onClick={() => {
                    void markRead(item);
                    if (item.href) navigate(item.href);
                  }}
                >
                  <span className="notif__icon">
                    <Icon name={KIND_ICON[item.kind] ?? 'bell'} size={16} />
                  </span>
                  <span className="notif__text">
                    <strong>{item.title}</strong>
                    {item.body ? <span>{item.body}</span> : null}
                    <em>{formatDateTime(item.createdAt)}</em>
                  </span>
                  {item.readAt ? null : <span className="notif__dot" aria-label="Unread" />}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
