/**
 * Virtual study rooms.
 *
 * One shared pomodoro clock per room, owned by the server. A learner joins,
 * heartbeats every few seconds, and sees the same timer and the same people as
 * everyone else. When a block ends the room advances itself; the host can start,
 * skip or stop the clock without resetting anybody else's session.
 *
 * Focus minutes are only banked during a FOCUS phase, and a participant who
 * stops heartbeating drops off the room within a minute.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ROOM_BREAK_DEFAULT,
  ROOM_CAPACITY,
  ROOM_FOCUS_DEFAULT,
  formatPomodoro,
  phaseHint,
  phaseLabel,
  type StudyRoomDetail,
  type StudyRoomsOverview,
} from '@shared/study';
import { Icon } from '../../components/Icon';
import { Badge, Button, Card, EmptyState, Loading, Notice, Select } from '../../components/ui';
import { PlayerAvatar } from '../../components/learn/PlayerAvatar';
import { useAsync } from '../../hooks/useAsync';
import { studyApi } from '../../lib/study-api';
import { describeError } from '../../lib/api';

const FOCUS_OPTIONS = [15, 25, 40, 50];

function RoomCard({
  room,
  onJoin,
  busy,
}: {
  room: StudyRoomsOverview['rooms'][number];
  onJoin: () => void;
  busy: boolean;
}) {
  return (
    <article className="sr-card">
      <header>
        <div>
          <h3>{room.name}</h3>
          <p className="tiny muted">Hosted by {room.hostName} · {room.occupants}/{room.capacity} inside</p>
        </div>
        <Badge tone={room.phase === 'FOCUS' ? 'success' : room.phase === 'BREAK' ? 'warning' : 'neutral'}>
          {phaseLabel(room.phase)}
        </Badge>
      </header>
      {room.topic ? <p className="small sr-card__topic">{room.topic}</p> : null}
      <div className="sr-card__foot">
        <span className="sr-card__clock">
          {room.phase === 'IDLE' ? `${room.focusMinutes}:00 blocks` : formatPomodoro(room.secondsLeft)}
        </span>
        <Button size="sm" variant="primary" loading={busy} onClick={onJoin}>
          Enter room
        </Button>
      </div>
    </article>
  );
}

export function StudyRoomPage() {
  const overview = useAsync<StudyRoomsOverview>(() => studyApi.rooms(), []);
  const [roomId, setRoomId] = useState<string | null>(null);
  const detail = useAsync<StudyRoomDetail | null>(
    () => (roomId ? studyApi.room(roomId) : Promise.resolve(null)),
    [roomId],
  );
  const [deadline, setDeadline] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [focusMinutes, setFocusMinutes] = useState(String(ROOM_FOCUS_DEFAULT));
  const [breakMinutes, setBreakMinutes] = useState(String(ROOM_BREAK_DEFAULT));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const data = overview.data;
  const room = detail.data;

  useEffect(() => {
    if (!room) return;
    setDeadline(Date.parse(room.serverNow) + room.secondsLeft * 1000);
  }, [room]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = room && room.phase !== 'IDLE' ? Math.max(0, Math.ceil((deadline - nowMs) / 1000)) : 0;

  // When the visible clock reaches zero, ask the server for the next phase. A
  // ref guard keeps the one-second tick from firing several requests.
  useEffect(() => {
    if (!roomId || !room || room.phase === 'IDLE' || remaining > 0 || syncingRef.current) return;
    syncingRef.current = true;
    void studyApi
      .heartbeat(roomId)
      .then((next) => detail.setData(next))
      .catch(() => undefined)
      .finally(() => {
        syncingRef.current = false;
      });
  }, [roomId, room, remaining, detail]);

  // Heartbeat while inside, which also banks focus seconds.
  useEffect(() => {
    if (!roomId) return;
    const beat = async () => {
      try {
        const next = await studyApi.heartbeat(roomId);
        detail.setData(next);
        setDeadline(Date.parse(next.serverNow) + next.secondsLeft * 1000);
      } catch {
        // A closed room stops the loop on the next explicit action.
      }
    };
    void beat();
    const timer = setInterval(() => void beat(), 12_000);
    return () => clearInterval(timer);
  }, [roomId, detail]);

  const act = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await run();
    } catch (actionError) {
      setError(describeError(actionError));
    } finally {
      setBusy(null);
    }
  };

  const join = (id: string) =>
    act(`join:${id}`, async () => {
      const joined = await studyApi.joinRoom(id);
      detail.setData(joined);
      setDeadline(Date.parse(joined.serverNow) + joined.secondsLeft * 1000);
      setRoomId(id);
      await overview.reload();
    });

  const leave = () =>
    act('leave', async () => {
      if (roomId) await studyApi.leaveRoom(roomId);
      setRoomId(null);
      detail.setData(null);
      await overview.reload();
    });

  const create = () =>
    act('create', async () => {
      const created = await studyApi.createRoom({
        name,
        topic,
        focusMinutes: Number(focusMinutes),
        breakMinutes: Number(breakMinutes),
      });
      setName('');
      setTopic('');
      detail.setData(created);
      setDeadline(Date.parse(created.serverNow) + created.secondsLeft * 1000);
      setRoomId(created.id);
      await overview.reload();
    });

  const phaseAction = (action: 'start' | 'skip' | 'stop') =>
    act(action, async () => {
      if (!roomId) return;
      const next = await studyApi.phase(roomId, action);
      detail.setData(next);
      setDeadline(Date.parse(next.serverNow) + next.secondsLeft * 1000);
    });

  if (overview.loading && !data) return <Loading label="Opening the study rooms…" />;
  if (overview.error && !data) {
    return (
      <Notice tone="danger" title="Study rooms could not be loaded">
        {overview.error}
      </Notice>
    );
  }

  if (roomId && room) {
    const total = (room.phase === 'BREAK' ? room.breakMinutes : room.focusMinutes) * 60;
    const fraction = total > 0 ? Math.min(1, remaining / total) : 0;
    const circumference = 2 * Math.PI * 52;
    return (
      <div className="stack sr-page">
        <div className="sr-roomhead">
          <Button variant="ghost" size="sm" onClick={() => void leave()} loading={busy === 'leave'}>
            <Icon name="arrowRight" size={14} style={{ transform: 'rotate(180deg)' }} /> Leave room
          </Button>
          <div>
            <h1>{room.name}</h1>
            <p className="tiny muted">
              Hosted by {room.hostName} · {room.members.length}/{ROOM_CAPACITY} inside
              {room.topic ? ` · ${room.topic}` : ''}
            </p>
          </div>
          <Badge tone={room.phase === 'FOCUS' ? 'success' : room.phase === 'BREAK' ? 'warning' : 'neutral'}>
            {phaseLabel(room.phase)}
          </Badge>
        </div>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        <div className="sr-room">
          <section className="sr-dial">
            <svg viewBox="0 0 120 120" role="img" aria-label={`${phaseLabel(room.phase)} timer ${formatPomodoro(remaining)}`}>
              <circle cx="60" cy="60" r="52" className="sr-dial__track" />
              <circle
                cx="60"
                cy="60"
                r="52"
                className="sr-dial__progress"
                strokeDasharray={`${circumference * fraction} ${circumference}`}
                transform="rotate(-90 60 60)"
              />
            </svg>
            <div className="sr-dial__center">
              <strong>{room.phase === 'IDLE' ? '—:—' : formatPomodoro(remaining)}</strong>
              <span>{phaseLabel(room.phase)} · {room.focusMinutes}/{room.breakMinutes}</span>
            </div>
            <p className="small muted sr-dial__hint">{phaseHint(room.phase, remaining)}</p>
            {room.isHost ? (
              <div className="sr-controls">
                {room.phase === 'IDLE' ? (
                  <Button variant="primary" loading={busy === 'start'} onClick={() => void phaseAction('start')}>
                    Start focus
                  </Button>
                ) : (
                  <Button variant="secondary" loading={busy === 'skip'} onClick={() => void phaseAction('skip')}>
                    Skip to {room.phase === 'FOCUS' ? 'break' : 'focus'}
                  </Button>
                )}
                {room.phase !== 'IDLE' ? (
                  <Button variant="ghost" loading={busy === 'stop'} onClick={() => void phaseAction('stop')}>
                    Stop
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="tiny muted">{room.phase === 'IDLE' ? 'The host will start the first block.' : 'The clock runs for everyone.'}</p>
            )}
          </section>

          <section className="sr-people">
            <div className="sr-today">
              <span className="muted tiny">Focus today</span>
              <b>
                {data?.minutesToday ?? 0} min
              </b>
              <span className="tiny muted">Across every room, only while a block is running.</span>
            </div>
            <h2>In the room</h2>
            <ul>
              {room.members.map((member) => (
                <li key={member.userId} className={member.isMe ? 'is-me' : undefined}>
                  <PlayerAvatar avatarId={member.avatarId} name={member.name} size={36} />
                  <span className="sr-people__who">
                    <b>{member.name}{member.isMe ? ' (you)' : ''}</b>
                    <span className="tiny muted">
                      {member.isHost ? 'host · ' : ''}
                      {member.minutesToday} min today
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="tiny muted">
              A learner drops off the list about a minute after they close the tab.
            </p>
          </section>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="stack sr-page">
      <div className="page-head">
        <div>
          <p className="page-head__kicker">Study rooms</p>
          <h1>Quiet company, one clock</h1>
          <p className="page-head__meta">
            Join a room, work through the shared focus block and log the minutes. Rooms hold up to {ROOM_CAPACITY} people;
            no cameras, no chat, just the clock.
          </p>
        </div>
        <Badge tone="accent">{data.minutesToday} focus minutes today</Badge>
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card title="Open a room" hint="Pomodoro blocks are shared; everyone sees the same countdown.">
        <div className="sr-form">
          <label className="field">
            <span className="field__label">Room name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Silent writing hour" maxLength={50} />
          </label>
          <label className="field sr-form__topic">
            <span className="field__label">What is the block for?</span>
            <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Task 2 introductions" maxLength={120} />
          </label>
          <label className="field">
            <span className="field__label">Focus</span>
            <Select value={focusMinutes} onChange={(event) => setFocusMinutes(event.target.value)}>
              {FOCUS_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>{minutes} min</option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field__label">Break</span>
            <Select value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)}>
              {[5, 10].map((minutes) => (
                <option key={minutes} value={minutes}>{minutes} min</option>
              ))}
            </Select>
          </label>
          <Button variant="primary" loading={busy === 'create'} disabled={name.trim().length < 3} onClick={() => void create()}>
            Open room
          </Button>
        </div>
      </Card>

      <Card title="Rooms open now" hint="Entering joins the room and starts your heartbeat.">
        {data.rooms.length === 0 ? (
          <EmptyState title="No rooms are open" icon="clock">
            Open one above and the next learner who joins will see the same clock.
          </EmptyState>
        ) : (
          <div className="sr-grid">
            {data.rooms.map((entry) => (
              <RoomCard
                key={entry.id}
                room={entry}
                onJoin={() => void join(entry.id)}
                busy={busy === `join:${entry.id}`}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
