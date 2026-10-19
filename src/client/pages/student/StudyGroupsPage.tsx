/**
 * Study groups.
 *
 * A group is a small, named set of learners chasing the same band, with a
 * weekly XP race inside it. The page suggests friends, classmates and people
 * with a similar target first, then shows groups already running.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GROUP_CAPACITY, GROUP_GOAL_MAX, GROUP_NAME_MAX, GROUP_TARGET_BANDS, type StudyGroupDetail, type StudyGroupsOverview } from '@shared/study';
import { Icon } from '../../components/Icon';
import { Badge, Button, Card, EmptyState, Loading, Notice, Select } from '../../components/ui';
import { PlayerAvatar } from '../../components/learn/PlayerAvatar';
import { useAsync } from '../../hooks/useAsync';
import { studyApi } from '../../lib/study-api';
import { describeError } from '../../lib/api';

function GroupCard({
  group,
  onOpen,
  onJoin,
  busy,
}: {
  group: StudyGroupsOverview['groups'][number];
  onOpen: () => void;
  onJoin?: () => void;
  busy?: boolean;
}) {
  return (
    <article className="sg-card">
      <header>
        <div>
          <h3>{group.name}</h3>
          <p className="tiny muted">
            Target {group.targetBand.toFixed(1)} · {group.memberCount}/{GROUP_CAPACITY} members
          </p>
        </div>
        {group.isOwner ? <Badge tone="accent">You host</Badge> : null}
      </header>
      {group.goal ? <p className="small sg-card__goal">{group.goal}</p> : null}
      <div className="row" style={{ marginTop: 'auto' }}>
        {group.joined ? (
          <Button size="sm" variant="secondary" onClick={onOpen}>
            Open group <Icon name="arrowRight" size={13} />
          </Button>
        ) : (
          <Button size="sm" variant="primary" loading={busy} onClick={onJoin}>
            Join
          </Button>
        )}
      </div>
    </article>
  );
}

export function StudyGroupsPage() {
  const overview = useAsync<StudyGroupsOverview>(() => studyApi.groups(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useAsync<StudyGroupDetail | null>(
    () => (selectedId ? studyApi.group(selectedId) : Promise.resolve(null)),
    [selectedId],
  );
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [targetBand, setTargetBand] = useState('6.5');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = overview.data;
  const act = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await run();
      await overview.reload();
      if (selectedId) await detail.reload();
    } catch (actionError) {
      setError(describeError(actionError));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy('create');
    setError(null);
    try {
      const created = await studyApi.createGroup({ name, goal, targetBand: Number(targetBand) });
      setName('');
      setGoal('');
      setSelectedId(created.id);
      await overview.reload();
    } catch (actionError) {
      setError(describeError(actionError));
    } finally {
      setBusy(null);
    }
  };

  if (overview.loading && !data) return <Loading label="Finding study groups…" />;
  if (overview.error && !data) {
    return (
      <Notice tone="danger" title="Study groups could not be loaded">
        {overview.error}
      </Notice>
    );
  }
  if (!data) return null;

  return (
    <div className="stack sg-page">
      <div className="page-head">
        <div>
          <p className="page-head__kicker">Study groups</p>
          <h1>A small group, a shared target</h1>
          <p className="page-head__meta">
            Groups hold up to {GROUP_CAPACITY} learners. Everyone’s weekly XP is on the board inside the group, so the
            competition is with people who are actually doing the work.
          </p>
        </div>
        <Badge tone="accent">{data.groups.length} group{data.groups.length === 1 ? '' : 's'}</Badge>
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card title="Start a group" hint="Name it after the goal, not the exam date.">
        <div className="sg-form">
          <label className="field">
            <span className="field__label">Group name</span>
            <input
              value={name}
              maxLength={GROUP_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              placeholder="Writing 7 by December"
            />
          </label>
          <label className="field">
            <span className="field__label">Target band</span>
            <Select value={targetBand} onChange={(event) => setTargetBand(event.target.value)}>
              {GROUP_TARGET_BANDS.map((band) => (
                <option key={band} value={band}>
                  {band.toFixed(1)}
                </option>
              ))}
            </Select>
          </label>
          <label className="field sg-form__goal">
            <span className="field__label">What are you working on?</span>
            <input
              value={goal}
              maxLength={GROUP_GOAL_MAX}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Two Task 2 essays a week, reviewed on Sunday"
            />
          </label>
          <Button variant="primary" loading={busy === 'create'} disabled={name.trim().length < 3} onClick={() => void create()}>
            Create group
          </Button>
        </div>
      </Card>

      {detail.data ? (
        <Card
          title={detail.data.name}
          hint={`${detail.data.memberCount} members · target ${detail.data.targetBand.toFixed(1)} · hosted by ${detail.data.ownerName}`}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
              Close
            </Button>
          }
        >
          {detail.data.goal ? <p className="small" style={{ marginTop: 0 }}>{detail.data.goal}</p> : null}
          <ol className="sg-members">
            {detail.data.members.map((member) => (
              <li key={member.userId} className={member.isMe ? 'is-me' : undefined}>
                <PlayerAvatar avatarId={member.avatarId} name={member.name} size={36} />
                <span className="sg-members__who">
                  <Link to={`/learn/profile/${encodeURIComponent(member.userId)}`}>{member.name}</Link>
                  <span className="tiny muted">
                    Lv. {member.level} · {member.online ? 'online now' : 'offline'}
                  </span>
                </span>
                <b className="sg-members__xp">{member.weeklyXp.toLocaleString('en')} XP</b>
              </li>
            ))}
          </ol>
          <div className="row">
            {detail.data.joined ? (
              <Button
                size="sm"
                variant="ghost"
                loading={busy === 'leave'}
                onClick={() => {
                  const id = detail.data!.id;
                  void act('leave', () => studyApi.leaveGroup(id)).then(() => setSelectedId(null));
                }}
              >
                Leave group
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                loading={busy === 'join'}
                onClick={() => void act('join', () => studyApi.joinGroup(detail.data!.id))}
              >
                Join this group
              </Button>
            )}
            <span className="tiny muted">The weekly race resets on Monday.</span>
          </div>
        </Card>
      ) : null}

      <Card title="Your groups" hint="Open one to see the board.">
        {data.groups.length === 0 ? (
          <EmptyState title="No groups yet" icon="users">
            Join one below or start your own above.
          </EmptyState>
        ) : (
          <div className="sg-grid">
            {data.groups.map((group) => (
              <GroupCard key={group.id} group={group} onOpen={() => setSelectedId(group.id)} />
            ))}
          </div>
        )}
      </Card>

      <Card title="Open groups near your target" hint="Sorted by how close the target band is to yours.">
        {data.discover.length === 0 ? (
          <EmptyState title="Nothing open right now" icon="users">
            Start a group and invite a friend or classmate.
          </EmptyState>
        ) : (
          <div className="sg-grid">
            {data.discover.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                onOpen={() => setSelectedId(group.id)}
                onJoin={() => void act(`join:${group.id}`, () => studyApi.joinGroup(group.id))}
                busy={busy === `join:${group.id}`}
              />
            ))}
          </div>
        )}
      </Card>

      <Card title="Suggested study buddies" hint="Friends, classmates and people chasing your band.">
        {data.suggestions.length === 0 ? (
          <EmptyState title="No suggestions yet" icon="heart">
            Add a friend or join a classroom and suggestions will appear here.
          </EmptyState>
        ) : (
          <ul className="sg-buddies">
            {data.suggestions.map((buddy) => (
              <li key={buddy.userId}>
                <PlayerAvatar avatarId={buddy.avatarId} name={buddy.name} size={38} />
                <span className="sg-members__who">
                  <Link to={`/learn/profile/${encodeURIComponent(buddy.userId)}`}>{buddy.name}</Link>
                  <span className="tiny muted">
                    {buddy.relation === 'FRIEND' ? 'Friend' : buddy.relation === 'CLASSMATE' ? 'Classmate' : 'Same target'}
                    {buddy.targetBand ? ` · target ${buddy.targetBand.toFixed(1)}` : ''}
                    {buddy.online ? ' · online' : ''}
                  </span>
                </span>
                <span className="tiny muted">{buddy.weeklyXp.toLocaleString('en')} XP</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
