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

const KIND_META: Record<CalendarEvent['kind'], { label: string; icon: IconName; tone: string }> = {
  SESSION: { label: 'Coaching', icon: 'video', tone: 'info' },
  CLASS: { label: 'Live class', icon: 'users', tone: 'success' },
  DEADLINE: { label: 'Deadline', icon: 'alert', tone: 'warning' },
  NOTE: { label: 'Your plan', icon: 'file', tone: 'neutral' },
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** The learner/coach calendar: sessions, classes, deadlines and your own plans. */
export function CalendarPage() {
  const toast = useToast();
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', note: '', date: dayKey(new Date().toISOString()), time: '19:00', duration: '60' });

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
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ margin: 0 }}>Calendar</h1>
        <div className="row gap-8">
          <Button size="sm" variant="ghost" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))} aria-label="Previous month">
            <Icon name="chevronRight" size={14} style={{ transform: 'rotate(180deg)' }} />
          </Button>
          <strong style={{ minWidth: 150, textAlign: 'center' }}>
            {anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </strong>
          <Button size="sm" variant="ghost" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))} aria-label="Next month">
            <Icon name="chevronRight" size={14} />
          </Button>
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />
            Add a plan
          </Button>
        </div>
      </div>

      <p className="muted small" style={{ margin: 0 }}>
        Coaching sessions, live classes, assignment deadlines and your own study plans — all in one place.
      </p>

      {events.loading && !events.data ? (
        <Loading label="Loading your calendar…" />
      ) : events.error ? (
        <Notice tone="danger">{events.error}</Notice>
      ) : (
        <Card>
          <div className="cal-grid" role="grid">
            {WEEKDAYS.map((day) => (
              <div key={day} className="cal-grid__head">
                {day}
              </div>
            ))}
            {cells.map((key, index) => {
              const dayEvents = key ? (byDay.get(key) ?? []) : [];
              const isToday = key === dayKey(new Date().toISOString());
              return (
                <button
                  key={`${key ?? 'pad'}-${index}`}
                  type="button"
                  className={`cal-cell${key ? '' : ' cal-cell--pad'}${isToday ? ' cal-cell--today' : ''}${selected === key ? ' cal-cell--selected' : ''}`}
                  onClick={() => key && setSelected(key)}
                  disabled={!key}
                >
                  {key ? Number(key.slice(-2)) : ''}
                  <span className="cal-cell__dots">
                    {dayEvents.slice(0, 3).map((event) => (
                      <i key={event.id} className={`cal-dot cal-dot--${event.kind.toLowerCase()}`} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {selected ? (
        <Card title={`Events · ${selected}`} hint="Your entries can be deleted; sessions and classes live on their pages.">
          {selectedEvents.length === 0 ? (
            <p className="muted small">Nothing planned for this day.</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {selectedEvents.map((event) => {
                const meta = KIND_META[event.kind];
                return (
                  <div key={event.id} className="row" style={{ alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                    <div className="row" style={{ alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Icon name={meta.icon} size={16} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontWeight: 700 }}>{event.title}</p>
                        <p className="tiny muted" style={{ margin: 0 }}>
                          {formatTime(event.startsAt)} – {formatTime(event.endsAt)}
                          {event.note ? ` · ${event.note}` : ''}
                        </p>
                      </div>
                      <Badge tone={meta.tone as 'info' | 'success' | 'warning' | 'neutral'}>{meta.label}</Badge>
                    </div>
                    {event.kind === 'NOTE' ? (
                      <Button size="sm" variant="ghost" onClick={() => void removeEvent(event.id)}>
                        <Icon name="trash" size={13} />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

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
