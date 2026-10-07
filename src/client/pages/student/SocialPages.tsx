import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PROFILE_AVATARS,
  PROFILE_BANNERS,
  PROFILE_COSMETIC_UNLOCKS,
  PROFILE_EFFECTS,
  PROFILE_NAME_COLORS,
  type ProfileAvatarKey,
  type ProfileBannerKey,
  type ProfileEffect,
  type ProfileNameColor,
  type PublicProfile,
  type PersonSummary,
} from '@shared/social';
import { Icon } from '../../components/Icon';
import { Button, Card, Loading, Notice, useToast } from '../../components/ui';
import { Mascot } from '../../components/learn/Mascot';
import { useAsync } from '../../hooks/useAsync';
import { describeError } from '../../lib/api';
import { socialApi } from '../../lib/social-api';
import './social.css';

const AVATAR_NAMES: Record<ProfileAvatarKey, string> = { bo: 'Bơ', muc: 'Mực', sen: 'Sen' };
const AVATAR_GLYPHS: Record<ProfileAvatarKey, string> = { bo: '🌱', muc: '🪼', sen: '🌸' };
const BANNER_NAMES: Record<ProfileBannerKey, string> = {
  default: 'Lavender',
  canopy: 'Canopy',
  sky: 'Sky',
  sakura: 'Sakura',
  midnight: 'Midnight',
};
const COLOR_NAMES: Record<ProfileNameColor, string> = { default: 'Default', sunset: 'Sunset', ocean: 'Ocean' };

function styleName(color: ProfileNameColor, effect: ProfileEffect): string {
  return `social-name social-name--${color}${effect === 'glow' ? ' social-name--glow' : ''}`;
}

function ProfileBanner({ banner, children }: { banner: ProfileBannerKey; children: ReactNode }) {
  return <header className={`social-banner social-banner--${banner}`}>{children}</header>;
}

function Presence({ online }: { online: boolean }) {
  return (
    <span className={`social-presence${online ? ' is-online' : ' is-offline'}`}>
      <i aria-hidden="true" /> {online ? 'Online now' : 'Offline'}
    </span>
  );
}

function SocialAvatar({ avatarKey, glow = false, size = 56, staticIcon = false }: { avatarKey: ProfileAvatarKey; glow?: boolean; size?: number; staticIcon?: boolean }) {
  return (
    <span className={`social-avatar${glow ? ' social-avatar--glow' : ''}`}>
      {staticIcon ? (
        <span className={`social-avatar__glyph social-avatar__glyph--${avatarKey}`} style={{ width: size, height: size }} aria-hidden="true">{AVATAR_GLYPHS[avatarKey]}</span>
      ) : <Mascot creature={avatarKey} mood="idle" size={size} />}
    </span>
  );
}

/** The appearance controls sit alongside the existing account name/security settings. */
export function ProfileAppearanceEditor() {
  const toast = useToast();
  const profile = useAsync(() => socialApi.me().then((response) => response.profile), []);
  const [draft, setDraft] = useState<Pick<PublicProfile, 'avatarKey' | 'bannerKey' | 'usernameColor' | 'profileEffect'> | null>(null);
  const [busy, setBusy] = useState(false);
  const appearance = profile.data
    ? draft ?? {
        avatarKey: profile.data.avatarKey,
        bannerKey: profile.data.bannerKey,
        usernameColor: profile.data.usernameColor,
        profileEffect: profile.data.profileEffect,
      }
    : { avatarKey: 'bo' as const, bannerKey: 'default' as const, usernameColor: 'default' as const, profileEffect: 'none' as const };
  const { avatarKey, bannerKey, usernameColor, profileEffect } = appearance;

  const owned = new Set(profile.data?.ownedCosmetics ?? []);
  const canUse = (choice: string) => {
    const cosmetic = PROFILE_COSMETIC_UNLOCKS[choice as ProfileBannerKey | ProfileNameColor | ProfileEffect];
    return !cosmetic || owned.has(cosmetic);
  };

  const save = async () => {
    setBusy(true);
    try {
      const response = await socialApi.updateProfile({ avatarKey, bannerKey, usernameColor, profileEffect });
      setDraft(null);
      profile.setData(response.profile);
      toast.push('Your profile appearance is saved.', 'success');
    } catch (error) {
      toast.push(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  };
  const resetPreview = () => setDraft(null);

  if (profile.loading && !profile.data) return <Loading label="Loading your public profile…" />;
  if (profile.error && !profile.data) {
    return <Notice tone="danger" title="Your public profile could not be loaded">{profile.error}</Notice>;
  }
  if (!profile.data) return null;

  const unlockedBadges = profile.data.achievements.filter((achievement) => achievement.unlocked);
  return (
    <div className="social-editor">
      <Card title="Your public learning profile" hint="Choose a creature and a look. Paid cosmetics are bought with Learn coins.">
        <ProfileBanner banner={bannerKey}>
          <SocialAvatar avatarKey={avatarKey} glow={profileEffect === 'glow'} size={76} />
          <div className="social-banner__identity">
            <span className="social-banner__level">LEVEL {profile.data.level.level}</span>
            <h2 className={styleName(usernameColor, profileEffect)}>{profile.data.displayName}</h2>
            <Presence online={profile.data.online} />
          </div>
          <Link className="social-banner__view" to={`/profiles/${encodeURIComponent(profile.data.id)}`}>View profile</Link>
        </ProfileBanner>

        <section className="social-control-group" aria-labelledby="profile-avatar-label">
          <h3 id="profile-avatar-label">Avatar</h3>
          <div className="social-choice-row" role="radiogroup" aria-label="Choose your creature avatar">
            {PROFILE_AVATARS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={avatarKey === key}
                className={`social-choice${avatarKey === key ? ' is-selected' : ''}`}
                onClick={() => setDraft({ ...appearance, avatarKey: key })}
              >
                <span className="social-choice__glyph" aria-hidden="true">{AVATAR_GLYPHS[key]}</span>
                <span>{AVATAR_NAMES[key]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="social-control-group" aria-labelledby="profile-banner-label">
          <h3 id="profile-banner-label">Profile cover</h3>
          <div className="social-choice-row" role="radiogroup" aria-label="Choose your profile cover">
            {PROFILE_BANNERS.map((key) => {
              const locked = !canUse(key);
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={bannerKey === key}
                  aria-disabled={locked}
                  className={`social-choice social-choice--banner social-banner--${key}${bannerKey === key ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}
                  onClick={() => !locked && setDraft({ ...appearance, bannerKey: key })}
                  title={locked ? 'Unlock this cover in the Learn shop.' : BANNER_NAMES[key]}
                >
                  <span>{BANNER_NAMES[key]}</span>{locked ? <Icon name="lock" size={12} /> : null}
                </button>
              );
            })}
          </div>
          <p className="social-help">Locked covers are permanent cosmetics; unlock one in the <Link to="/learn/shop">Learn shop</Link>.</p>
        </section>

        <section className="social-control-group" aria-labelledby="profile-colour-label">
          <h3 id="profile-colour-label">Username colour</h3>
          <div className="social-choice-row" role="radiogroup" aria-label="Choose a username colour">
            {PROFILE_NAME_COLORS.map((key) => {
              const locked = !canUse(key);
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={usernameColor === key}
                  aria-disabled={locked}
                  className={`social-choice social-color-choice social-name--${key}${usernameColor === key ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}
                  onClick={() => !locked && setDraft({ ...appearance, usernameColor: key })}
                >
                  {COLOR_NAMES[key]}{locked ? <Icon name="lock" size={12} /> : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="social-control-group" aria-labelledby="profile-effect-label">
          <h3 id="profile-effect-label">Profile effect</h3>
          <div className="social-choice-row" role="radiogroup" aria-label="Choose a profile effect">
            {PROFILE_EFFECTS.map((key) => {
              const locked = !canUse(key);
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={profileEffect === key}
                  aria-disabled={locked}
                  className={`social-choice${profileEffect === key ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}
                  onClick={() => !locked && setDraft({ ...appearance, profileEffect: key })}
                >
                  {key === 'glow' ? 'Soft glow' : 'No effect'}{locked ? <Icon name="lock" size={12} /> : null}
                </button>
              );
            })}
          </div>
        </section>

        <div className="social-editor__actions">
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            <Icon name="check" size={15} /> Save appearance
          </Button>
          <Button variant="ghost" onClick={resetPreview}>
            <Icon name="rotate" size={14} /> Discard changes
          </Button>
        </div>
        {unlockedBadges.length > 0 ? (
          <div className="social-editor__badges" aria-label="Badges earned">
            <b>Badges earned</b>
            {unlockedBadges.map((badge) => <span key={badge.id}>{badge.name}</span>)}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function PersonLine({ person, children }: { person: PersonSummary; children?: ReactNode }) {
  return (
    <article className="social-person">
      <SocialAvatar avatarKey={person.avatarKey} glow={person.profileEffect === 'glow'} size={40} staticIcon />
      <div className="social-person__identity">
        <Link className={styleName(person.usernameColor, person.profileEffect)} to={`/profiles/${encodeURIComponent(person.id)}`}>
          {person.displayName}
        </Link>
        <span>Level {person.level} · {person.xp.toLocaleString('en')} XP</span>
        <Presence online={person.online} />
      </div>
      <div className="social-person__actions">{children}</div>
    </article>
  );
}

export function FriendsPage() {
  const toast = useToast();
  const friends = useAsync(() => socialApi.friends(), []);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [peopleForQuery, setPeopleForQuery] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setSearchBusy(true);
      setSearchError(null);
      setPeople([]);
      void socialApi.search(clean).then((result) => {
        if (alive) {
          setPeople(result.people);
          setPeopleForQuery(clean);
        }
      }).catch((error: unknown) => {
        if (alive) {
          setPeople([]);
          setPeopleForQuery(clean);
          setSearchError(describeError(error));
        }
      }).finally(() => {
        if (alive) setSearchBusy(false);
      });
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, revision]);

  const refresh = async () => {
    await friends.reload();
    setRevision((value) => value + 1);
  };

  const visiblePeople = peopleForQuery === query.trim() ? people : [];

  const runAction = async (id: string, action: () => Promise<unknown>, message: string) => {
    setBusyId(id);
    try {
      await action();
      toast.push(message, 'success');
      await refresh();
    } catch (error) {
      toast.push(describeError(error), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="social-page">
      <header className="social-page__hero">
        <div className="social-page__hero-icon"><Icon name="users" size={25} /></div>
        <div>
          <p className="social-page__kicker">Learning together</p>
          <h1>Friends</h1>
          <p>Find classmates by their chosen display name, send requests, and see who is around. Email addresses stay private.</p>
        </div>
      </header>

      <Card title="Find learners" hint="Search matches public display names only.">
        <label className="social-search">
          <Icon name="search" size={18} />
          <input value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)} placeholder="Search names…" aria-label="Search learners by display name" />
        </label>
        {query.trim().length < 2 ? <p className="social-help">Enter at least two characters to search.</p> : null}
        {query.trim().length >= 2 && searchBusy ? <Loading label="Searching profiles…" /> : null}
        {query.trim().length >= 2 && peopleForQuery === query.trim() && searchError ? <Notice tone="danger" title="Search could not be completed">{searchError}</Notice> : null}
        {query.trim().length >= 2 && !searchBusy && peopleForQuery === query.trim() && !searchError && visiblePeople.length === 0 ? <p className="social-help">No matching profiles found.</p> : null}
        <div className="social-people">
          {visiblePeople.map((person) => (
            <PersonLine key={person.id} person={person}>
              {person.status === 'FRIENDS' ? <Button size="sm" variant="ghost" disabled>Friends</Button> : null}
              {person.status === 'PENDING_SENT' ? <Button size="sm" variant="ghost" disabled>Request sent</Button> : null}
              {person.status === 'PENDING_RECEIVED' ? (
                <Button size="sm" variant="success" loading={busyId === person.id} onClick={() => void runAction(person.id, () => socialApi.request(person.id), 'Friend request accepted.')}>Accept</Button>
              ) : null}
              {person.status === 'NONE' ? (
                <Button size="sm" variant="primary" loading={busyId === person.id} onClick={() => void runAction(person.id, () => socialApi.request(person.id), 'Friend request sent.')}>Add friend</Button>
              ) : null}
            </PersonLine>
          ))}
        </div>
      </Card>

      {friends.loading && !friends.data ? <Loading label="Loading your friends…" /> : null}
      {friends.error && !friends.data ? <Notice tone="danger" title="Friends could not be loaded">{friends.error}</Notice> : null}
      {friends.data ? (
        <>
          <Card title={`Friend requests${friends.data.incoming.length ? ` · ${friends.data.incoming.length} waiting` : ''}`}>
            {friends.data.incoming.length === 0 ? <p className="social-help">No requests waiting. Your incoming requests will appear here.</p> : null}
            <div className="social-people">
              {friends.data.incoming.map((person) => (
                <PersonLine key={person.requestId} person={person}>
                  <Button size="sm" variant="success" loading={busyId === person.requestId} onClick={() => void runAction(person.requestId, () => socialApi.respond(person.requestId, true), 'You are now friends.')}>Accept</Button>
                  <Button size="sm" variant="ghost" loading={busyId === person.requestId} onClick={() => void runAction(person.requestId, () => socialApi.respond(person.requestId, false), 'Request declined.')}>Decline</Button>
                </PersonLine>
              ))}
            </div>
            {friends.data.outgoing.length > 0 ? (
              <details className="social-outgoing">
                <summary>Sent requests ({friends.data.outgoing.length})</summary>
                <div className="social-people">
                  {friends.data.outgoing.map((person) => <PersonLine key={person.requestId} person={person}><Button size="sm" variant="ghost" disabled>Waiting</Button></PersonLine>)}
                </div>
              </details>
            ) : null}
          </Card>

          <Card title={`Your friends · ${friends.data.friends.length}`}>
            {friends.data.friends.length === 0 ? (
              <div className="social-empty">
                <Mascot creature="sen" mood="wave" size={70} />
                <p>No friends yet. Search for a learner above to get started.</p>
              </div>
            ) : (
              <div className="social-people">
                {friends.data.friends.map((person) => (
                  <PersonLine key={person.id} person={person}>
                    <Button size="sm" variant="ghost" loading={busyId === person.id} onClick={() => void runAction(person.id, () => socialApi.remove(person.id), 'Friend removed.')}>Remove</Button>
                  </PersonLine>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

export function PublicProfilePage() {
  const { profileId = '' } = useParams();
  const profile = useAsync(() => socialApi.profile(profileId).then((response) => response.profile), [profileId]);
  if (profile.loading && !profile.data) return <Loading label="Loading profile…" />;
  if (profile.error && !profile.data) return <Notice tone="danger" title="This profile could not be opened">{profile.error}</Notice>;
  if (!profile.data) return null;

  const person: PublicProfile = profile.data;
  const unlocked = person.achievements.filter((achievement) => achievement.unlocked);
  return (
    <div className="social-page social-public">
      <Link className="social-back" to="/learn/leaderboard"><Icon name="arrowRight" size={14} /> Back to leaderboards</Link>
      <ProfileBanner banner={person.bannerKey}>
        <SocialAvatar avatarKey={person.avatarKey} glow={person.profileEffect === 'glow'} size={100} />
        <div className="social-banner__identity">
          <span className="social-banner__level">LEVEL {person.level.level}</span>
          <h1 className={styleName(person.usernameColor, person.profileEffect)}>{person.displayName}</h1>
          <Presence online={person.online} />
        </div>
        <Link className="social-banner__view" to="/friends">Find friends</Link>
      </ProfileBanner>

      <section className="social-level card" aria-label="XP level progress">
        <div className="social-level__top">
          <div><span className="social-level__eyebrow">Level {person.level.level}</span><strong>{person.xp.toLocaleString('en')} XP</strong></div>
          <span>{person.level.xpIntoLevel} / {person.level.xpForNextLevel} XP to next level</span>
        </div>
        <div className="social-level__bar" role="progressbar" aria-label="Progress to next level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={person.level.progress}><span style={{ width: `${person.level.progress}%` }} /></div>
      </section>

      <section className="social-stats" aria-label="Learning stats">
        <article><Icon name="flame" size={20} /><strong>{person.streak}</strong><span>day streak</span></article>
        <article><Icon name="target" size={20} /><strong>{person.lessonsCompleted}</strong><span>lessons completed</span></article>
        <article><Icon name="book" size={20} /><strong>{person.practiceTests}</strong><span>tests submitted</span></article>
      </section>

      <section className="social-achievements card">
        <header><div><h2>Achievements</h2><p>Badges are earned through learning and practice.</p></div><span>{unlocked.length} / {person.achievements.length}</span></header>
        <div className="social-achievements__grid">
          {person.achievements.map((achievement) => (
            <article key={achievement.id} className={`social-achievement${achievement.unlocked ? ' is-unlocked' : ''}`}>
              <span className="social-achievement__icon"><Icon name={achievement.unlocked ? 'award' : 'lock'} size={20} /></span>
              <div><strong>{achievement.name}</strong><p>{achievement.description}</p><span>{achievement.progress} / {achievement.target}{achievement.unlocked ? ' · Earned' : ''}</span></div>
            </article>
          ))}
        </div>
      </section>

      <div className="social-page__footer">
        <Link className="btn btn--secondary" to="/friends"><Icon name="users" size={15} /> Friends</Link>
        <Link className="btn btn--ghost" to="/profile">My profile settings</Link>
      </div>
    </div>
  );
}
