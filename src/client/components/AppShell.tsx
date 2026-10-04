import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { boostState } from '@shared/shop';
import { useAuth } from '../context/AuthContext';
import { learnApi } from '../lib/learn-api';
import { BrandLogo } from './BrandLogo';
import { DisplayMenu } from './DisplayMenu';
import { Icon, type IconName } from './Icon';
import { SiteFooter } from './SiteFooter';
import { Button, Loading } from './ui';
import { initials } from '../lib/format';

/**
 * Application shell.
 *
 * A white top bar with the logo and pill-style links (desktop) or a bottom tab bar (below
 * 960px), and one "More" panel that is a dropdown on a wide screen and a bottom sheet on a
 * phone. The navy footer carries the brand, the links and the standing disclaimer, so there is
 * no banner on every page.
 */
interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

/** Main places for a signed-in candidate, in the order they are used. */
const MAIN_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: 'home' },
  { to: '/learn', label: 'Learn', icon: 'target' },
  { to: '/practice', label: 'Practice', icon: 'book' },
  { to: '/history', label: 'Results', icon: 'award' },
  { to: '/vocabulary', label: 'Vocabulary', icon: 'layers' },
  { to: '/dictionary', label: 'Dictionary', icon: 'search' },
];

/** Everything else lives behind "More". */
const MORE_NAV: NavItem[] = [
  { to: '/learn/shop', label: 'Shop', icon: 'cart' },
  { to: '/learn/leaderboard', label: 'Leaderboards', icon: 'trophy' },
  { to: '/learn/plan', label: 'Study plan', icon: 'calendar' },
  { to: '/speaking', label: 'Speaking', icon: 'mic' },
  { to: '/analytics', label: 'My progress', icon: 'chart' },
  { to: '/classrooms', label: 'Classrooms', icon: 'users' },
  { to: '/profile', label: 'Profile', icon: 'user' },
];

/** The four phone tabs for a candidate; the fifth opens the More sheet. */
const TAB_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: 'home' },
  { to: '/learn', label: 'Learn', icon: 'target' },
  { to: '/practice', label: 'Practice', icon: 'book' },
  { to: '/vocabulary', label: 'Words', icon: 'layers' },
];

/** Sections of the landing page; from any other public page these navigate to "/" and scroll. */
const PUBLIC_NAV = [
  { hash: '#skills', label: 'Four skills' },
  { hash: '#learn', label: 'Learning path' },
  { hash: '#marking', label: 'AI marking' },
  { hash: '#teachers', label: 'For teachers' },
];

const STAFF_ADMIN: NavItem = { to: '/admin', label: 'Admin', icon: 'shield' };
const STAFF_TEACHING: NavItem = { to: '/teacher', label: 'Teaching', icon: 'presentation' };
const STAFF_MARKING: NavItem = { to: '/teacher/marking', label: 'Marking', icon: 'pen' };

/**
 * What each role sees in the bar. Candidates get the six places they use; teachers and
 * administrators get their own console first (it is what they came for) with Practice and
 * Learn beside it, and everything else sits behind "More" so no bar ever overflows.
 */
function navFor(role: string | undefined): { top: NavItem[]; tabs: NavItem[]; home: string } {
  const practice = MAIN_NAV[2]!;
  const learn = MAIN_NAV[1]!;
  if (role === 'ADMIN') {
    return { top: [STAFF_ADMIN, STAFF_TEACHING, STAFF_MARKING, practice, learn], tabs: [STAFF_ADMIN, STAFF_TEACHING, STAFF_MARKING, practice], home: '/admin' };
  }
  if (role === 'TEACHER') {
    return { top: [STAFF_TEACHING, STAFF_MARKING, practice, learn], tabs: [STAFF_TEACHING, STAFF_MARKING, practice, learn], home: '/teacher' };
  }
  return { top: MAIN_NAV, tabs: TAB_NAV, home: '/dashboard' };
}

const samePlace = (pathname: string, item: NavItem) => pathname === item.to || pathname.startsWith(`${item.to}/`);

export function AppShell() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [panelOpen, setPanelOpen] = useState(false);
  const [coins, setCoins] = useState<number | null>(null);
  const [boosted, setBoosted] = useState(false);

  // The coin balance belongs to the whole shell, not to the shop page: it is the
  // thing that makes "spend it or lose the habit" visible while the learner is
  // on the path. Refreshed on every navigation, which is where a lesson or a
  // purchase can have changed it. A failure is silent on purpose — the chip is
  // a shortcut, and the shop page itself explains what went wrong.
  useEffect(() => {
    if (user?.role !== 'STUDENT') return;
    let alive = true;
    learnApi
      .overview()
      .then((data) => {
        if (!alive) return;
        setCoins(data.profile.coins);
        setBoosted(boostState(data.profile.xpBoostUntil)?.active === true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user?.role, location.pathname]);

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
  // Behind "More": every candidate place that is not already in the top bar. The phone sheet
  // also lists what the top bar has but the four phone tabs do not.
  const overflowNav = [...MAIN_NAV, ...MORE_NAV].filter((item) => !nav.top.some((top) => top.to === item.to));
  const phoneOnlyNav = nav.top.filter((item) => !nav.tabs.some((tab) => tab.to === item.to));

  const signOut = async () => {
    await logout();
    setPanelOpen(false);
    navigate('/');
  };

  const bleed = !user && location.pathname === '/';
  const moreActive = overflowNav.some((item) => samePlace(location.pathname, item));
  const inTopNav = nav.top.some((item) => samePlace(location.pathname, item));
  const inTabs = nav.tabs.some((item) => samePlace(location.pathname, item));

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-header__inner">
          <NavLink to={user ? nav.home : '/'} className="site-brand" aria-label="Ai eo home">
            <BrandLogo theme="auto" height={32} />
          </NavLink>

          {user ? (
            <nav className="site-nav" aria-label="Main">
              {nav.top.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/teacher'} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                  {item.label}
                </NavLink>
              ))}
              <button
                type="button"
                className={`site-nav__more${moreActive && !inTopNav ? ' active' : ''}`}
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
                {user.role === 'STUDENT' && coins !== null ? (
                  <NavLink
                    to="/learn/shop"
                    className="coin-chip"
                    title={boosted ? 'Coins — double XP is running' : 'Coins — spend them in the shop'}
                    aria-label={`${coins} coins, open the shop`}
                  >
                    <Icon name="coin" size={15} />
                    <b>{coins.toLocaleString('en')}</b>
                    {boosted ? <em>×2</em> : null}
                  </NavLink>
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

      {user ? (
        <nav className="site-tabbar" aria-label="Main">
          {nav.tabs.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/teacher'} className={({ isActive }) => `site-tabbar__item${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className={`site-tabbar__item${panelOpen || ((moreActive || inTopNav) && !inTabs) ? ' active' : ''}`}
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

            {phoneOnlyNav.length > 0 ? (
              <div className="more-panel__group more-panel__group--phone">
                {phoneOnlyNav.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.to === '/teacher'} className="more-item" role="menuitem">
                    <Icon name={item.icon} size={17} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ) : null}
            <div className="more-panel__group">
              {overflowNav.map((item) => (
                <NavLink key={item.to} to={item.to} className="more-item" role="menuitem">
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
