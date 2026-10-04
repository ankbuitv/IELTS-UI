import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AVATARS, NAME_EFFECTS, PROFILE_EFFECTS, type FriendOverview, type FriendSearchResult, type GamificationProfile, type PlayerCard } from '@shared/gamification';
import type { NameEffect, ProfileEffect } from '@shared/gamification';
import { PlayerAvatar, badgeName, playerNameClass } from '../../components/learn/PlayerAvatar';
import { Icon } from '../../components/Icon';
import { Button, Loading, Notice, useToast } from '../../components/ui';
import { describeError } from '../../lib/api';
import { learnApi } from '../../lib/learn-api';
import type { ShopState } from '@shared/shop';

function PlayerCardLink({ player, trailing }: { player: PlayerCard; trailing?: React.ReactNode }) {
  return (
    <div className="social-player">
      <Link className="social-player__link" to={`/learn/profile/${encodeURIComponent(player.userId)}`}>
        <PlayerAvatar avatarId={player.avatarId} name={player.displayName} effect={player.profileEffect} />
        <span className="social-player__identity">
          <b className={playerNameClass(player.nameEffect)}>
            <i className={`presence-dot${player.online ? ' is-online' : ''}`} />
            {player.displayName}
            {player.role === 'ADMIN' ? <em className="board__role">Admin</em> : null}
          </b>
          <span>Lv. {player.level} · {player.xp.toLocaleString()} XP · {player.streak} day streak</span>
          {player.badgeIds.length ? <span className="social-player__badges">{player.badgeIds.slice(0, 2).map(badgeName).join(' · ')}</span> : null}
        </span>
      </Link>
      {trailing ? <span className="social-player__action">{trailing}</span> : null}
    </div>
  );
}

function Panel({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="card social-panel">
      <header><h2>{title}</h2>{count !== undefined ? <span className="learn-card__count">{count}</span> : null}</header>
      {children}
    </section>
  );
}

export function FriendPage() {
  const toast = useToast();
  const [data, setData] = useState<FriendOverview | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FriendSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await learnApi.friends();
    setData(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    learnApi.friends().then((next) => { if (!cancelled) setData(next); })
      .catch((cause) => { if (!cancelled) setError(describeError(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      learnApi.searchPeople(clean)
        .then((response) => { if (!cancelled) setResults(response.results); })
        .catch((cause) => { if (!cancelled) toast.push(describeError(cause), 'error'); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, toast]);

  const act = async (userId: string, action: 'request' | 'accept' | 'remove') => {
    setBusy(userId);
    try {
      if (action === 'request') await learnApi.requestFriend(userId);
      else if (action === 'accept') await learnApi.acceptFriend(userId);
      else await learnApi.removeFriend(userId);
      await reload();
      if (query.trim().length >= 2) {
        const response = await learnApi.searchPeople(query.trim());
        setResults(response.results);
      }
      toast.push(action === 'request' ? 'Friend request sent.' : action === 'accept' ? 'Friend request accepted.' : 'Friend removed.', 'success');
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setBusy(null);
    }
  };

  const relationshipAction = (result: FriendSearchResult) => {
    const { player, relationship } = result;
    if (relationship === 'FRIEND') return <Button size="sm" variant="secondary" loading={busy === player.userId} onClick={() => void act(player.userId, 'remove')}>Remove</Button>;
    if (relationship === 'PENDING_INCOMING') return <Button size="sm" variant="primary" loading={busy === player.userId} onClick={() => void act(player.userId, 'accept')}>Accept</Button>;
    if (relationship === 'PENDING_OUTGOING') return <Button size="sm" variant="secondary" disabled>Requested</Button>;
    return <Button size="sm" variant="primary" loading={busy === player.userId} onClick={() => void act(player.userId, 'request')}><Icon name="plus" size={13} /> Add</Button>;
  };

  if (loading && !data) return <Loading label="Loading your friends…" />;
  if (error && !data) return <Notice tone="danger" title="Friends could not load">{error}</Notice>;

  return (
    <main className="social-page">
      <header className="page-heading social-page__heading">
        <div><p className="eyebrow">Learn together</p><h1>Friends</h1><p className="muted">Find learners, send requests, and keep each other moving.</p></div>
        <Link className="btn" to="/learn"><Icon name="book" size={15} /> Learn path</Link>
      </header>

      <section className="card social-search">
        <label htmlFor="people-search"><Icon name="search" size={18} /> Find a learner</label>
        <input id="people-search" type="search" value={query} onChange={(event) => { const value = event.target.value; setQuery(value); setResults([]); setSearching(false); }} placeholder="Search by display name" maxLength={60} autoComplete="off" />
        {searching ? <span className="muted small">Searching…</span> : null}
        {query.trim().length > 0 && query.trim().length < 2 ? <p className="muted small">Type at least two characters.</p> : null}
        {query.trim().length >= 2 && !searching && results.length === 0 ? <p className="muted small">No matching learners found.</p> : null}
        {results.length ? <div className="social-player-list">{results.map((result) => <PlayerCardLink key={result.player.userId} player={result.player} trailing={relationshipAction(result)} />)}</div> : null}
      </section>

      {data?.incoming.length ? (
        <Panel title="Requests for you" count={data.incoming.length}>
          <div className="social-player-list">{data.incoming.map((player) => <PlayerCardLink key={player.userId} player={player} trailing={<Button size="sm" variant="primary" loading={busy === player.userId} onClick={() => void act(player.userId, 'accept')}>Accept</Button>} />)}</div>
        </Panel>
      ) : null}
      {data?.outgoing.length ? (
        <Panel title="Requests sent" count={data.outgoing.length}>
          <div className="social-player-list">{data.outgoing.map((player) => <PlayerCardLink key={player.userId} player={player} trailing={<span className="muted small">Waiting</span>} />)}</div>
        </Panel>
      ) : null}
      <Panel title="Your friends" count={data?.friends.length ?? 0}>
        {data?.friends.length ? (
          <div className="social-player-list">{data.friends.map((player) => <PlayerCardLink key={player.userId} player={player} trailing={<Button size="sm" variant="ghost" loading={busy === player.userId} onClick={() => void act(player.userId, 'remove')}>Remove</Button>} />)}</div>
        ) : <p className="muted">Your friends will appear here. Search for someone by their display name to get started.</p>}
      </Panel>
    </main>
  );
}

export function PublicPlayerProfilePage() {
  const { userId = '' } = useParams();
  const toast = useToast();
  const [profile, setProfile] = useState<GamificationProfile | null>(null);
  const [shop, setShop] = useState<ShopState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (userId ? learnApi.publicPlayerProfile(userId) : learnApi.myPlayerProfile())
      .then(async (response) => {
        if (cancelled) return;
        setProfile(response.profile);
        setError(null);
        setLoadedKey(userId || 'self');
        if (response.profile.relationship === 'SELF') setShop(await learnApi.shop().catch(() => null));
      })
      .catch((cause) => { if (!cancelled) { setError(describeError(cause)); setLoadedKey(userId || 'self'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  const save = async (input: { avatarId?: string; nameEffect?: string; profileEffect?: string }) => {
    setSaving(true);
    try {
      const response = await learnApi.updatePlayerIdentity(input);
      setProfile(response.profile);
      toast.push('Profile updated.', 'success');
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const actOnFriend = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      if (profile.relationship === 'PENDING_INCOMING') await learnApi.acceptFriend(userId);
      else if (profile.relationship === 'FRIEND') await learnApi.removeFriend(userId);
      else await learnApi.requestFriend(userId);
      const response = userId ? await learnApi.publicPlayerProfile(userId) : await learnApi.myPlayerProfile();
      setProfile(response.profile);
      toast.push(profile.relationship === 'FRIEND' ? 'Friend removed.' : profile.relationship === 'PENDING_INCOMING' ? 'Friend request accepted.' : 'Friend request sent.', 'success');
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading || loadedKey !== (userId || 'self')) return <Loading label="Opening player profile…" />;
  if (error || !profile) return <Notice tone="danger" title="Player profile could not load">{error ?? 'That player could not be found.'}</Notice>;
  const self = profile.relationship === 'SELF';
  const owned = shop?.inventory ?? {};
  const badgeIds = new Set(profile.badgeIds);

  return (
    <main className="social-page player-profile-page">
      <header className={`player-profile-hero player-profile-hero--${profile.profileEffect}`}>
        <Link className="player-profile-hero__back" to={self ? '/learn' : '/learn/friends'}><Icon name="chevronRight" style={{ transform: 'rotate(180deg)' }} size={15} /> {self ? 'Learn' : 'Friends'}</Link>
        <div className="player-profile-hero__identity">
          <PlayerAvatar avatarId={profile.avatarId} name={profile.displayName} size={100} effect={profile.profileEffect} />
          <div>
            <p className="eyebrow">{profile.role === 'ADMIN' ? 'Administrator' : 'Learner'} profile</p>
            <h1 className={playerNameClass(profile.nameEffect)}><i className={`presence-dot${profile.online ? ' is-online' : ''}`} />{profile.displayName}</h1>
            <p className="player-profile-hero__meta">Level {profile.level} · {profile.xp.toLocaleString()} XP · {profile.streak} day streak{profile.online ? ' · Online now' : ' · Offline'}</p>
          </div>
        </div>
        <div className="player-profile-hero__actions">
          {self ? <Link className="btn" to="/learn/shop"><Icon name="cart" size={15} /> Cosmetic shop</Link> : (
            <Button variant="primary" loading={saving} onClick={() => void actOnFriend()}>
              {profile.relationship === 'FRIEND' ? 'Remove friend' : profile.relationship === 'PENDING_INCOMING' ? 'Accept request' : profile.relationship === 'PENDING_OUTGOING' ? 'Request sent' : 'Add friend'}
            </Button>
          )}
        </div>
      </header>

      <section className="profile-level card">
        <div className="profile-level__label"><b>Level {profile.level}</b><span>{profile.xp.toLocaleString()} / {profile.nextLevelXp.toLocaleString()} XP</span></div>
        <div className="profile-level__bar"><i style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div>
        <span className="muted small">{Math.max(0, profile.nextLevelXp - profile.xp)} XP to level {profile.level + 1}</span>
      </section>

      {self ? (
        <section className="card profile-customise">
          <header><h2>Make it yours</h2><p className="muted small">Choose an avatar, then equip name colours and profile effects you own from the shop.</p></header>
          <div className="profile-customise__avatars" aria-label="Choose avatar">
            {AVATARS.map((avatar) => (
              <button key={avatar.id} type="button" className={`profile-avatar-option${profile.avatarId === avatar.id ? ' is-on' : ''}`} disabled={saving} onClick={() => void save({ avatarId: avatar.id })} aria-label={`Choose ${avatar.name} avatar`} aria-pressed={profile.avatarId === avatar.id}>
                <PlayerAvatar avatarId={avatar.id} name={avatar.name} size={48} /><span>{avatar.name}</span>
              </button>
            ))}
          </div>
          <div className="profile-customise__effects">
            <label>Name colour
              <select value={profile.nameEffect} disabled={saving} onChange={(event) => void save({ nameEffect: event.target.value as NameEffect })}>
                {NAME_EFFECTS.map((effect) => <option key={effect} value={effect} disabled={effect === 'gold' ? !owned.cosmetic_name_gold : effect === 'nebula' ? !owned.cosmetic_name_nebula : false}>{effect === 'default' ? 'Default' : effect === 'gold' ? `Golden name${owned.cosmetic_name_gold ? '' : ' · shop'}` : `Nebula gradient${owned.cosmetic_name_nebula ? '' : ' · shop'}`}</option>)}
              </select>
            </label>
            <label>Profile effect
              <select value={profile.profileEffect} disabled={saving} onChange={(event) => void save({ profileEffect: event.target.value as ProfileEffect })}>
                {PROFILE_EFFECTS.map((effect) => <option key={effect} value={effect} disabled={effect === 'glow' ? !owned.cosmetic_profile_glow : effect === 'sparkle' ? !owned.cosmetic_profile_sparkle : false}>{effect === 'none' ? 'None' : effect === 'glow' ? `Aura${owned.cosmetic_profile_glow ? '' : ' · shop'}` : `Starlight frame${owned.cosmetic_profile_sparkle ? '' : ' · shop'}`}</option>)}
              </select>
            </label>
          </div>
        </section>
      ) : null}

      <section className="player-profile-stats">
        <div className="card"><Icon name="bolt" size={20} /><b>{profile.stats.xp.toLocaleString()}</b><span>Total XP</span></div>
        <div className="card"><Icon name="book" size={20} /><b>{profile.stats.lessons}</b><span>Lessons completed</span></div>
        <div className="card"><Icon name="flame" size={20} /><b>{profile.stats.bestStreak}</b><span>Best streak</span></div>
        <div className="card"><Icon name="users" size={20} /><b>{profile.stats.friends}</b><span>Study friends</span></div>
      </section>

      <section className="card achievement-panel">
        <header><h2>Achievements</h2><span>{badgeIds.size}/{profile.achievements.length} unlocked</span></header>
        <div className="achievement-grid">
          {profile.achievements.map((achievement) => (
            <article key={achievement.id} className={`achievement${achievement.unlocked ? ' is-unlocked' : ''}`}>
              <span className="achievement__icon" aria-hidden="true">{achievement.icon}</span>
              <span className="achievement__copy"><b>{achievement.name}</b><small>{achievement.description}</small></span>
              <span className="achievement__progress">{achievement.unlocked ? 'Unlocked' : `${achievement.progress}/${achievement.target}`}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
