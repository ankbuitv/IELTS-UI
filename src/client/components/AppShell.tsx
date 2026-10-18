import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { boostState } from '@shared/shop';
import { useAuth } from '../context/AuthContext';
import { learnApi } from '../lib/learn-api';
import { api } from '../lib/api';
import { BrandLogo } from './BrandLogo';
import { DisplayMenu } from './DisplayMenu';
import { Icon, type IconName } from './Icon';
import { SiteFooter } from './SiteFooter';
import { Button, Loading } from './ui';
import { initials } from '../lib/format';

/**
 * Application shell.
 *
 * Signed in, the desktop gets a soft lavender sidebar — the control centre of
 * the app (learning, coaching, rewards, admin) — with the wallet chips and the
 * account card anchored at the bottom, exactly like the playful learning apps
 * this design language borrows from. The slim top bar carries the search, the
 * display menu, "Start a test" and the avatar. Phones keep the bottom tab bar
 * and the one "More" sheet. Public pages use the marketing top nav instead.
 */
interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Main places for a signed-in candidate, in the order they are used. */
const LEARN_GROUP: NavGroup = {
  label: 'Learn',
  items: [
    { to: '/dashboard', label: 'Home', icon: 'home' },
    { to: '/learn', label: 'Learn path', icon: 'target' },
    { to: '/practice', label: 'Practice', icon: 'book' },
    { to: '/history', label: 'Results', icon: 'award' },
    { to: '/vocabulary', label: 'Vocabulary', icon: 'layers' },
    { to: '/dictionary', label: 'Dictionary', icon: 'search' },
  ],
};

/** The mentor world: book a coach, upcoming calls, live classes. */
const COACHING_GROUP: NavGroup = {
  label: 'Coaching',
  items: [
    { to: '/mentors', label: 'Find a mentor', icon: 'graduation' },
    { to: '/my-sessions', label: 'My sessions', icon: 'video' },
    { to: '/classes', label: 'Live classes', icon: 'users' },
  ],
};

const GROW_GROUP: NavGroup = {
  label: 'Grow',
  items: [
    { to: '/speaking', label: 'Speaking', icon: 'mic' },
    { to: '/analytics', label: 'My progress', icon: 'chart' },
    { to: '/learn/plan', label: 'Study plan', icon: 'calendar' },
    { to: '/classrooms', label: 'Classrooms', icon: 'presentation' },
  ],
};

const REWARDS_GROUP: NavGroup = {
  label: 'Rewards',
  items: [
    { to: '/learn/shop', label: 'Shop', icon: 'cart' },
    { to: '/learn/leaderboard', label: 'Leaderboard', icon: 'trophy' },
    { to: '/learn/friends', label: 'Friends', icon: 'heart' },
    { to: '/profile', label: 'Profile', icon: 'user' },
  ],
};

const MENTOR_GROUP: NavGroup = {
  label: 'Mentor',
  items: [
    { to: '/mentor', label: 'Console', icon: 'presentation' },
    { to: '/my-sessions', label: 'Sessions', icon: 'video' },
    { to: '/classes', label: 'My classes', icon: 'users' },
    { to: '/mentors', label: 'Directory', icon: 'graduation' },
  ],
};

/** The four phone tabs for a candidate; the fifth opens the More sheet. */
const TAB_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: 'home' },
  { to: '/learn', label: 'Learn', icon: 'target' },
  { to: '/mentors', label: 'Mentors', icon: 'graduation' },
  { to: '/practice', label: 'Practice', icon: 'book' },
];

/** Sections of the landing page; from any other public page these navigate to "/" and scroll. */
const PUBLIC_NAV = [
  { hash: '#skills', label: 'Four skills' },
  { hash: '#learn', label: 'Learning path' },
  { hash: '#marking', label: 'AI marking' },
  { hash: '#teachers', label: 'For teachers' },
];

/**
 * What each role sees in the sidebar. Candidates get the full playground;
 * mentors get their console first; teachers and administrators lead with the
 * console they came for and keep coaching beside it.
 */
function navFor(role: string | undefined): { groups: NavGroup[]; tabs: NavItem[]; home: string } {
  if (role === 'ADMIN') {
    return {
      groups: [
        {
          label: 'Manage',
          items: [
            { to: '/admin', label: 'Admin console', icon: 'shield' },
            { to: '/teacher', label: 'Teaching', icon: 'presentation' },
            { to: '/teacher/marking', label: 'Marking queue', icon: 'pen' },
          ],
        },
        LEARN_GROUP,
        COACHING_GROUP,
        GROW_GROUP,
        REWARDS_GROUP,
      ],
      tabs: [
        { to: '/admin', label: 'Admin', icon: 'shield' },
        { to: '/teacher', label: 'Teaching', icon: 'presentation' },
        { to: '/learn', label: 'Learn', icon: 'target' },
        { to: '/practice', label: 'Practice', icon: 'book' },
      ],
      home: '/admin',
    };
  }
  if (role === 'TEACHER') {
    return {
      groups: [
        {
          label: 'Teaching',
          items: [
            { to: '/teacher', label: 'Teaching console', icon: 'presentation' },
            { to: '/teacher/marking', label: 'Marking queue', icon: 'pen' },
            { to: '/practice', label: 'Practice', icon: 'book' },
            { to: '/learn', label: 'Learn path', icon: 'target' },
          ],
        },
        COACHING_GROUP,
        GROW_GROUP,
        REWARDS_GROUP,
      ],
      tabs: [
        { to: '/teacher', label: 'Teaching', icon: 'presentation' },
        { to: '/teacher/marking', label: 'Marking', icon: 'pen' },
        { to: '/learn', label: 'Learn', icon: 'target' },
        { to: '/practice', label: 'Practice', icon: 'book' },
      ],
      home: '/teacher',
    };
  }
  if (role === 'MENTOR') {
    return {
      groups: [
        MENTOR_GROUP,
        LEARN_GROUP,
        GROW_GROUP,
      ],
      tabs: [
        { to: '/mentor', label: 'Console', icon: 'presentation' },
        { to: '/my-sessions', label: 'Sessions', icon: 'video' },
        { to: '/classes', label: 'Classes', icon: 'users' },
        { to: '/practice', label: 'Practice', icon: 'book' },
      ],
      home: '/mentor',
    };
  }
  return {
    groups: [LEARN_GROUP, COACHING_GROUP, GROW_GROUP, REWARDS_GROUP],
    tabs: TAB_NAV,
    home: '/dashboard',
  };
}

const samePlace = (pathname: string, item: NavItem) => pathname === item.to || pathname.startsWith(`${item.to}/`);

export function AppShell() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [panelOpen, setPanelOpen] = useState(false);
  const [coins, setCoins] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const [xp, setXp] = useState<number | null>(null);
  const [boosted, setBoosted] = useState(false);
  const heartbeatUserId = user?.id;

  // The wallet chips live in the whole shell, not just the shop: they are what
  // makes "spend it or lose the habit" visible while the learner is on the
  // path. Refreshed on every navigation, which is where a lesson or a purchase
  // can have changed them. A failure is silent on purpose — the chips are a
  // shortcut, and the shop page itself explains what went wrong.
  useEffect(() => {
    if (user?.role !== 'STUDENT') return;
    let alive = true;
    learnApi
      .overview()
      .then((data) => {
        if (!alive) return;
        setCoins(data.profile.coins);
        setStreak(data.profile.streak ?? 0);
        setXp(data.profile.xp ?? 0);
        setBoosted(boostState(data.profile.xpBoostUntil)?.active === true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user?.role, location.pathname]);

  // Keep the leaderboard's short-lived presence marker accurate while a signed-in
  // learner is actively using the app. Hidden tabs stop pinging and naturally
  // become offline after the server's five-minute window.
  useEffect(() => {
    if (!heartbeatUserId) return;
    let inFlight = false;
    const beat = () => {
      if (document.visibilityState === 'hidden' || inFlight) return;
      inFlight = true;
      void api.post('/api/auth/heartbeat', {}).catch(() => undefined).finally(() => {
        inFlight = false;
      });
    };
    const interval = window.setInterval(beat, 60_000);
    window.addEventListener('focus', beat);
    document.addEventListener('visibilitychange', beat);
    beat();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', beat);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [heartbeatUserId]);

  // Close the panel whenever the page changes or Escape is pressed.
  useEffect(() => {
    setPanelOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="site">
        <Loading label="Checking your session…" />
      </div>
    );
  }

  const nav = navFor(user?.role);
  // Behind "More": every place that is not one of the four phone tabs. The phone
  // sheet also lists what the sidebar has but the tabs do not.
  const allItems = nav.groups.flatMap((group) => group.items);
  const overflowNav = allItems.filter((item) => !nav.tabs.some((tab) => tab.to === item.to));

  const signOut = async () => {
    await logout();
    setPanelOpen(false);
    navigate('/');
  };

  const bleed = !user && location.pathname === '/';
  const inTabs = nav.tabs.some((item) => samePlace(location.pathname, item));
  const moreActive = overflowNav.some((item) => samePlace(location.pathname, item));

  return (
    <div className={`site${user ? ' site--app' : ''}`}>
      {user ? (
        <aside className="app-sidebar">
          <NavLink to={nav.home} className="app-sidebar__brand" aria-label="Ai eo home">
            <BrandLogo theme="light" height={30} />
          </NavLink>

          <Button
            variant="primary"
            className="app-sidebar__cta"
            onClick={() => navigate('/practice')}
          >
            <Icon name="play" size={13} />
            Start a test
          </Button>

          <nav className="app-sidebar__nav" aria-label="Main">
            {nav.groups.map((group) => (
              <div key={group.label} className="app-sidebar__group">
                <span className="app-sidebar__label">{group.label}</span>
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/teacher' || item.to === '/admin' || item.to === '/mentor'}
                    className={({ isActive }) => `app-nav-item${isActive ? ' active' : ''}`}
                  >
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className="app-sidebar__foot">
            {user.role === 'STUDENT' && coins !== null ? (
              <div className="app-sidebar__wallet">
                <NavLink to="/learn/shop" className="wallet-chip" title="Coins — spend them in the shop">
                  <Icon name="coin" size={14} />
                  {coins.toLocaleString('en')}
                </NavLink>
                <span className="wallet-chip wallet-chip--streak" title="Day streak">
                  <Icon name="flame" size={14} filled />
                  {streak ?? 0}
                </span>
                <span className="wallet-chip wallet-chip--xp" title="Total XP">
                  <Icon name="bolt" size={14} />
                  {xp ?? 0}
                </span>
              </div>
            ) : null}
            <button type="button" className="app-sidebar__user" onClick={() => setPanelOpen((open) => !open)}>
              <span className="site-avatar site-avatar--lg" aria-hidden="true">
                {initials(user.displayName)}
              </span>
              <span className="app-sidebar__user-text">
                <strong title={user.displayName}>{user.displayName}</strong>
                <span>{user.role.toLowerCase()}</span>
              </span>
              <Icon name="chevronDown" size={15} />
            </button>
          </div>
        </aside>
      ) : null}

      <div className="app-frame">
        <header className="site-header">
          <div className="site-header__inner">
            <NavLink to={user ? nav.home : '/'} className="site-brand" aria-label="Ai eo home">
              <BrandLogo theme="auto" height={30} />
            </NavLink>

            {user ? (
              <nav className="site-nav" aria-label="Main">
                {nav.tabs.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.to === '/teacher' || item.to === '/admin' || item.to === '/mentor'} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                    {item.label}
                  </NavLink>
                ))}
                <button
                  type="button"
                  className={`site-nav__more${moreActive && !inTabs ? ' active' : ''}`}
                  aria-expanded={panelOpen}
                  aria-haspopup="menu"
                  onClick={() => setPanelOpen((open) => !open)}
                >
                  More
                  <Icon name="chevronDown" size={13} />
                </button>
              </nav>
            ) : (
              <nav className="site-nav site-nav--public" aria-label="Site">
                {PUBLIC_NAV.map((item) => (
                  <Link key={item.hash} to={{ pathname: '/', hash: item.hash }}>
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}

            <div className="site-actions">
              {user ? (
                <>
                  <span className="site-search" aria-hidden="true">
                    <Icon name="search" size={15} />
                    Search lessons, words, mentors…
                  </span>
                  {user.role === 'STUDENT' && coins !== null ? (
                    <>
                      <NavLink
                        to="/learn/shop"
                        className="wallet-chip"
                        title={boosted ? 'Coins — double XP is running' : 'Coins — spend them in the shop'}
                        aria-label={`${coins} coins, open the shop`}
                      >
                        <Icon name="coin" size={14} />
                        <b>{coins.toLocaleString('en')}</b>
                        {boosted ? <em>×2</em> : null}
                      </NavLink>
                      <span className="wallet-chip wallet-chip--streak" title="Day streak">
                        <Icon name="flame" size={14} filled />
                        <b>{streak ?? 0}</b>
                      </span>
                    </>
                  ) : null}
                  <DisplayMenu compact label="Display" />
                  <NavLink to="/practice" className="btn btn--sm btn--primary site-cta">
                    <Icon name="play" size={12} />
                    <span>Start a test</span>
                  </NavLink>
                  <button
                    type="button"
                    className="site-avatar"
                    title={user.displayName}
                    aria-label="Account menu"
                    aria-expanded={panelOpen}
                    onClick={() => setPanelOpen((open) => !open)}
                  >
                    {initials(user.displayName)}
                  </button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => navigate('/login')}>
                    Sign in
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => navigate('/register')}>
                    Create account
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>

        <main className={`site-main${bleed ? ' site-main--bleed' : ''}`}>
          <Outlet />
        </main>

        <SiteFooter role={user?.role} compact={Boolean(user)} />
      </div>

      {user ? (
        <nav className="site-tabbar" aria-label="Main">
          {nav.tabs.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/teacher' || item.to === '/admin' || item.to === '/mentor'}
              className={({ isActive }) => `site-tabbar__item${isActive ? ' active' : ''}`}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className={`site-tabbar__item${panelOpen || (moreActive && !inTabs) ? ' active' : ''}`}
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
          >
            <Icon name="menu" size={20} />
            <span>More</span>
          </button>
        </nav>
      ) : null}

      {user && panelOpen ? (
        <>
          <div className="more-backdrop" onClick={() => setPanelOpen(false)} />
          <div className="more-panel" role="menu" aria-label="More">
            <div className="more-panel__who">
              <span className="site-avatar site-avatar--lg" aria-hidden="true">
                {initials(user.displayName)}
              </span>
              <span className="more-panel__who-text">
                <strong title={user.displayName}>{user.displayName}</strong>
                <span>{user.role.toLowerCase()}</span>
              </span>
            </div>

            <div className="more-panel__group">
              {overflowNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/teacher' || item.to === '/admin' || item.to === '/mentor'}
                  className={({ isActive }) => `more-item${isActive ? ' active' : ''}`}
                  role="menuitem"
                >
                  <Icon name={item.icon} size={17} />
                  {item.label}
                </NavLink>
              ))}
            </div>
            <div className="more-panel__group">
              <button type="button" className="more-item more-item--button" onClick={signOut} role="menuitem">
                <Icon name="logout" size={17} />
                Sign out
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
