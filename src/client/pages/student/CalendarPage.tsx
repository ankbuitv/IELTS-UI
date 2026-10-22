import { useMemo, useState } from 'react';
import { api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, Field, Loading, Modal, Notice, TextArea, TextInput, useToast } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';

interface CalendarEvent {
  kind: 'NOTE' | 'SESSION' | 'CLASS' | 'DEADLINE';
  id: string;
  title: string;
  note: string;
  startsAt: string;
  endsAt: string;
}

const KIND_META: Record<CalendarEvent['kind'], { label: string; icon: IconName; tone: 'info' | 'success' | 'warning' | 'neutral' }> = {
  SESSION: { label: 'Coaching', icon: 'video', tone: 'info' },
  CLASS: { label: 'Live class', icon: 'users', tone: 'success' },
  DEADLINE: { label: 'Deadline', icon: 'alert', tone: 'warning' },
  NOTE: { label: 'Your plan', icon: 'file', tone: 'neutral' },
};

const LEGEND: CalendarEvent['kind'][] = ['SESSION', 'CLASS', 'DEADLINE', 'NOTE'];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** A short, human day label: "Today", "Tomorrow", or "Wed 22 Oct". */
function dayHeading(key: string, todayKey: string): string {
  const date = new Date(`${key}T00:00:00`);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (key === todayKey) return 'Today';
  if (key === dayKey(tomorrow.toISOString())) return 'Tomorrow';
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** The learner/coach calendar: sessions, classes, deadlines and your own plans. */
export function CalendarPage() {
  const toast = useToast();
  const todayKey = dayKey(new Date().toISOString());
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<string | null>(todayKey);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', note: '', date: todayKey, time: '19:00', duration: '60' });

  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59);
  const query = `from=${encodeURIComponent(monthStart.toISOString())}&to=${encodeURIComponent(monthEnd.toISOString())}`;

  const events = useAsync<{ events: CalendarEvent[] }>(() => api.get(`/api/student/calendar?${query}`), [query]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events.data?.events ?? []) {
      const key = dayKey(event.startsAt);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    // Keep each day's entries in time order.
    for (const list of map.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return map;
  }, [events.data]);

  // Build the month grid (Mon-first).
  const cells = useMemo(() => {
    const first = (monthStart.getDay() + 6) % 7;
    const total = monthEnd.getDate();
    const out: Array<string | null> = Array(first).fill(null);
    for (let day = 1; day <= total; day += 1) {
      out.push(`${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [anchor, monthStart, monthEnd]);

  const selectedEvents = (selected && byDay.get(selected)) || [];
  const monthTotal = events.data?.events.length ?? 0;

  const jumpToToday = () => {
    setAnchor(new Date());
    setSelected(todayKey);
  };

  const shiftMonth = (delta: number) => {
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1));
  };

  const addEvent = async () => {
    const startsAt = new Date(`${draft.date}T${draft.time}:00`);
    const endsAt = new Date(startsAt.getTime() + Math.max(15, Number(draft.duration) || 60) * 60_000);
    try {
      await api.post('/api/student/calendar', {
        title: draft.title.trim(),
        note: draft.note.trim() || undefined,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });
      toast.push('Added to your calendar.', 'success');
      setAdding(false);
      setDraft({ ...draft, title: '', note: '' });
      // Show the month (and day) the new plan landed on.
      setAnchor(new Date(startsAt.getFullYear(), startsAt.getMonth(), 1));
      setSelected(dayKey(startsAt.toISOString()));
      await events.reload();
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    }
  };

  const removeEvent = async (id: string) => {
    try {
      await api.delete(`/api/student/calendar/${id}`);
      toast.push('Entry removed.', 'success');
      await events.reload();
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    }
  };

  return (
    <div className="stack">
      <div className="cal-top">
        <div>
          <h1 style={{ margin: 0 }}>Calendar</h1>
          <p className="cal-top__sub">
            Coaching, live classes, deadlines and your own plans — one agenda.
          </p>
        </div>
        <div className="row gap-8">
          <Button size="sm" variant="ghost" onClick={jumpToToday}>
            Today
          </Button>
          <div className="cal-nav">
            <button type="button" className="cal-nav__btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <Icon name="chevronRight" size={16} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <span className="cal-nav__label">
              {anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <button type="button" className="cal-nav__btn" onClick={() => shiftMonth(1)} aria-label="Next month">
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />
            Add a plan
          </Button>
        </div>
      </div>

      {events.loading && !events.data ? (
        <Loading label="Loading your calendar…" />
      ) : events.error ? (
        <Notice tone="danger">{events.error}</Notice>
      ) : (
        <div className="cal">
          <Card className="cal__month">
            <div className="cal-grid" role="grid" aria-label="Month">
              {WEEKDAYS.map((day) => (
                <div key={day} className="cal-grid__head" role="columnheader">
                  {day}
                </div>
              ))}
              {cells.map((key, index) => {
                const dayEvents = key ? (byDay.get(key) ?? []) : [];
                const isToday = key === todayKey;
                const isSelected = key !== null && selected === key;
                return (
                  <button
                    key={`${key ?? 'pad'}-${index}`}
                    type="button"
                    className={`cal-cell${key ? '' : ' cal-cell--pad'}${isToday ? ' cal-cell--today' : ''}${isSelected ? ' cal-cell--selected' : ''}`}
                    onClick={() => key && setSelected(key)}
                    disabled={!key}
                    aria-current={isToday ? 'date' : undefined}
                    aria-pressed={isSelected}
                  >
                    <span className="cal-cell__day">{key ? Number(key.slice(-2)) : ''}</span>
                    {dayEvents.length > 0 && (
                      <span className="cal-cell__chips">
                        {dayEvents.slice(0, 2).map((event) => (
                          <span key={event.id} className={`cal-chip cal-chip--${event.kind.toLowerCase()}`}>
                            <i className="cal-chip__dot" />
                            <span className="cal-chip__label">{event.title}</span>
                          </span>
                        ))}
                        {dayEvents.length > 2 && <span className="cal-cell__more">+{dayEvents.length - 2} more</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="cal-legend" aria-hidden="true">
              {LEGEND.map((kind) => (
                <span key={kind} className={`cal-legend__item cal-legend__item--${kind.toLowerCase()}`}>
                  <i className="cal-legend__dot" />
                  {KIND_META[kind].label}
                </span>
              ))}
            </div>
          </Card>

          <aside className="cal__agenda" aria-label="Selected day">
            <header className="agenda__head">
              <div className="agenda__date">
                {selected ? dayHeading(selected, todayKey) : 'Select a day'}
              </div>
              {selected && selected !== todayKey ? (
                <button type="button" className="agenda__today" onClick={jumpToToday}>
                  Today
                </button>
              ) : null}
            </header>

            {selected ? (
              <div className="agenda__sub">
                {new Date(`${selected}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
                <span className="agenda__count">
                  {selectedEvents.length} {selectedEvents.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>
            ) : null}

            {selectedEvents.length === 0 ? (
              <div className="agenda__empty">
                <Icon name="calendar" size={22} />
                <p>Nothing planned for this day.</p>
                <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                  <Icon name="plus" size={13} />
                  Add a plan
                </Button>
              </div>
            ) : (
              <ul className="agenda__list">
                {selectedEvents.map((event) => {
                  const meta = KIND_META[event.kind];
                  return (
                    <li key={event.id} className={`agenda__item agenda__item--${event.kind.toLowerCase()}`}>
                      <span className="agenda__icon">
                        <Icon name={meta.icon} size={15} />
                      </span>
                      <div className="agenda__body">
                        <div className="agenda__row">
                          <span className="agenda__time">
                            {formatTime(event.startsAt)} – {formatTime(event.endsAt)}
                          </span>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </div>
                        <p className="agenda__title">{event.title}</p>
                        {event.note ? <p className="agenda__note">{event.note}</p> : null}
                      </div>
                      {event.kind === 'NOTE' ? (
                        <button
                          type="button"
                          className="agenda__remove"
                          onClick={() => void removeEvent(event.id)}
                          aria-label={`Remove ${event.title}`}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {monthTotal > 0 ? (
              <footer className="agenda__foot">
                {monthTotal} {monthTotal === 1 ? 'entry' : 'entries'} this month
              </footer>
            ) : null}
          </aside>
        </div>
      )}

      <Modal open={adding} title="Add a plan" onClose={() => setAdding(false)}>
        <div className="stack">
          <Field label="Title" required>
            {(id) => (
              <TextInput id={id} value={draft.title} placeholder="e.g. Reading drill — passage 3" onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            )}
          </Field>
          <Field label="Note" hint="Optional — what to cover, links, reminders.">
            {(id) => <TextArea id={id} rows={3} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />}
          </Field>
          <div className="row gap-8">
            <div style={{ flex: 1 }}>
              <Field label="Date" required>
                {(id) => <TextInput id={id} type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />}
              </Field>
            </div>
            <div style={{ width: 120 }}>
              <Field label="Time" required>
                {(id) => <TextInput id={id} type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} />}
              </Field>
            </div>
            <div style={{ width: 110 }}>
              <Field label="Minutes">
                {(id) => <TextInput id={id} type="number" min={15} step={15} value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: event.target.value })} />}
              </Field>
            </div>
          </div>
          <Button variant="primary" onClick={() => void addEvent()} disabled={!draft.title.trim()}>
            Save to calendar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
