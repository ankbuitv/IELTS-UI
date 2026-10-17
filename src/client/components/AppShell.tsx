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
 * Two shapes, because the two jobs are different:
 *
 *  - Signed-in app (≥1024px): a left rail-collapsible **sidebar** carrying the
 *    whole navigation, grouped into labelled sections, with the learner's coin
 *    balance, the display controls and the account pinned at the bottom. The
 *    content column keeps a single page title, so nothing is duplicated in a top
 *    bar. Below 1024px the sidebar folds into a top strip plus a floating tab
 *    dock, and everything that does not fit in the dock opens as a tiled sheet.
 *  - Public site (`/` and the marketing pages): no sidebar — a landing page wants
 *    its full width, so those routes keep the familiar translucent top bar.
 *
 * Every route change re-keys the content column, which is what plays the entry
 * animation (see `.route` in styles/app.css); the animation is fully disabled by
 * the reader's "reduce motion" preference.
 */
interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  hint?: string;
  /** Match only the exact path (used by /teacher, which owns children). */
  end?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

/** The four phone tabs; the fifth opens the sheet. */
const CANDIDATE_TABS: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: 'home' },
  { to: '/learn', label: 'Learn', icon: 'target' },
  { to: '/practice', label: 'Practice', icon: 'book' },
  { to: '/vocabulary', label: 'Words', icon: 'layers' },
];

/** Candidate navigation, in the order a learner actually uses it. */
const CANDIDATE_GROUPS: NavGroup[] = [
  {
    title: 'Today',
    items: [
      { to: '/dashboard', label: 'Home', icon: 'home' },
      { to: '/learn', label: 'Learning path', icon: 'target', hint: 'Lessons, streak, XP' },
      { to: '/practice', label: 'Practice tests', icon: 'book', hint: 'Timed sets, real exam screen' },
      { to: '/speaking', label: 'Speaking', icon: 'mic', hint: 'Record and get a band' },
    ],
  },
  {
    title: 'Your results',
    items: [
      { to: '/history', label: 'Attempt history', icon: 'award' },
      { to: '/analytics', label: 'Progress', icon: 'chart', hint: 'Bands by skill' },
      { to: '/classrooms', label: 'Classrooms', icon: 'users' },
    ],
  },
  {
    title: 'Words',
    items: [
      { to: '/vocabulary', label: 'Vocabulary', icon: 'layers' },
      { to: '/dictionary', label: 'Dictionary', icon: 'search' },
      { to: '/learn/everyday', label: 'Everyday English', icon: 'globe' },
    ],
  },
  {
    title: 'Rewards',
    items: [
      { to: '/learn/shop', label: 'Shop', icon: 'cart' },
      { to: '/learn/leaderboard', label: 'Leaderboards', icon: 'trophy' },
      { to: '/learn/friends', label: 'Friends', icon: 'users' },
      { to: '/learn/plan', label: 'Study plan', icon: 'calendar' },
    ],
  },
];

const TEACHER_GROUPS: NavGroup[] = [
  {
    title: 'Teaching',
    items: [
      { to: '/teacher', label: 'Overview', icon: 'presentation', end: true, hint: 'Classrooms and assignments' },
      { to: '/teacher/marking', label: 'Marking queue', icon: 'pen' },
      { to: '/classrooms', label: 'Classrooms', icon: 'users' },
    ],
  },
  {
    title: 'Materials',
    items: [
      { to: '/practice', label: 'Test library', icon: 'book' },
      { to: '/learn', label: 'Learning path', icon: 'target' },
      { to: '/analytics', label: 'My progress', icon: 'chart' },
    ],
  },
];

const ADMIN_GROUPS: NavGroup[] = [
  {
    title: 'Platform',
    items: [
      { to: '/admin', label: 'Admin console', icon: 'shield', end: true, hint: 'Health and settings' },
      { to: '/admin/tests', label: 'Tests', icon: 'book' },
      { to: '/admin/imports', label: 'AI imports', icon: 'upload' },
      { to: '/admin/writing', label: 'Writing queue', icon: 'pen' },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/admin/users', label: 'Users', icon: 'users' },
      { to: '/admin/attempts', label: 'Attempts', icon: 'list' },
      { to: '/admin/scoring-profiles', label: 'Scoring profiles', icon: 'target' },
      { to: '/admin/learn', label: 'Learning content', icon: 'layers' },
    ],
  },
  {
    title: 'Teaching',
    items: [
      { to: '/teacher', label: 'Teacher console', icon: 'presentation', end: true },
      { to: '/teacher/marking', label: 'Marking queue', icon: 'pen' },
      { to: '/practice', label: 'Test library', icon: 'book' },
    ],
  },
];

/** Accounts for the account menu at the bottom of the rail. */
const ACCOUNT_LINKS: NavItem[] = [
  { to: '/profile', label: 'Profile', icon: 'user' },
  { to: '/learn/profile', label: 'Public learner card', icon: 'bookmark' },
];

const TEACHER_TABS: NavItem[] = [TEACHER_GROUPS[0]!.items[0]!, TEACHER_GROUPS[0]!.items[1]!, TEACHER_GROUPS[0]!.items[2]!, TEACHER_GROUPS[1]!.items[0]!];
const ADMIN_TABS: NavItem[] = [ADMIN_GROUPS[0]!.items[0]!, ADMIN_GROUPS[0]!.items[1]!, ADMIN_GROUPS[0]!.items[3]!, ADMIN_GROUPS[1]!.items[0]!];

/** Sections of the landing page; from any other public page these navigate to "/" and scroll. */
const PUBLIC_NAV = [
  { hash: '#skills', label: 'Four skills' },
  { hash: '#learn', label: 'Learning path' },
  { hash: '#marking', label: 'AI marking' },
  { hash: '#teachers', label: 'For teachers' },
];

function navFor(role: string | undefined): { groups: NavGroup[]; tabs: NavItem[]; home: string; label: string } {
  if (role === 'ADMIN') {
    return { groups: ADMIN_GROUPS, tabs: ADMIN_TABS, home: '/admin', label: 'Administrator' };
  }
  if (role === 'TEACHER') {
    return { groups: TEACHER_GROUPS, tabs: TEACHER_TABS, home: '/teacher', label: 'Teacher' };
  }
  return { groups: CANDIDATE_GROUPS, tabs: CANDIDATE_TABS, home: '/dashboard', label: 'Student' };
}

const RAIL_KEY = 'shell:rail';
const readRail = () => {
  try {
    return window.localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
};

export function AppShell() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [rail, setRail] = useState(readRail);
  const [coins, setCoins] = useState<number | null>(null);
  const [boosted, setBoosted] = useState(false);
  const heartbeatUserId = user?.id;

  useEffect(() => {
    try {
      window.localStorage.setItem(RAIL_KEY, rail ? '1' : '0');
    } catch {
      /* private mode: the preference is cosmetic */
    }
  }, [rail]);

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

  // Keep the leaderboard's short-lived presence marker accurate while a signed-in
  // learner is actively using the app. Hidden tabs stop pinging and naturally
  // become offline after the server's five-minute window.
  useEffect(() => {
    if (!heartbeatUserId) return undefined;
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

  // Navigation closes the overlays. This is done while rendering rather than in
  // an effect: the shell has to paint the new page without a frame of the old
  // sheet still open above it.
  const [overlayPath, setOverlayPath] = useState(location.pathname);
  if (overlayPath !== location.pathname) {
    setOverlayPath(location.pathname);
    setSheetOpen(false);
    setAccountOpen(false);
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSheetOpen(false);
        setAccountOpen(false);
      }
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
  const signOut = async () => {
    await logout();
    setSheetOpen(false);
    navigate('/');
  };

  const bleed = location.pathname === '/';
  const sheetItems = nav.groups.flatMap((group) => (group.title === 'Today' ? group.items.slice(1) : group.items));

  // ---------------------------------------------------------------- public bar
  // Signed-out site: the landing and marketing pages take the full width, so they
  // keep a translucent top bar instead of the app's sidebar.
  if (!user) {
    return (
      <div className="site">
        <header className="site-header">
          <div className="site-header__inner">
            <Link to="/" className="site-brand" aria-label="Ai eo home">
              <BrandLogo theme="auto" height={32} />
            </Link>
            <nav className="site-nav" aria-label="Site">
              {PUBLIC_NAV.map((item) => (
                <Link key={item.hash} to={{ pathname: '/', hash: item.hash }}>
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="site-actions">
              <Button size="sm" variant="ghost" onClick={() => navigate('/login')}>
                Sign in
              </Button>
              <Button size="sm" variant="primary" onClick={() => navigate('/register')}>
                Create account
              </Button>
            </div>
          </div>
        </header>
        <main className={`site-main${bleed ? ' site-main--bleed' : ''}`}>
          <div className="route" key={location.pathname}>
            <Outlet />
          </div>
        </main>
        <SiteFooter role={undefined} compact={false} />
      </div>
    );
  }

  // ------------------------------------------------------------- app sidebar
  return (
    <div className={`site site--app${rail ? ' site--rail' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <aside className={`sidebar${rail ? ' sidebar--rail' : ''}`} aria-label="Main navigation">
        <div className="sidebar__brand">
          <NavLink to={nav.home} className="sidebar__logo" aria-label="Ai eo home">
            <BrandLogo theme="auto" height={28} />
          </NavLink>
          <button
            type="button"
            className="sidebar__collapse"
            onClick={() => setRail((value) => !value)}
            title={rail ? 'Expand the menu' : 'Collapse the menu'}
            aria-label={rail ? 'Expand the menu' : 'Collapse the menu'}
            aria-pressed={rail}
          >
            <Icon name="panelLeft" size={17} />
          </button>
        </div>

        <Link to="/practice" className="sidebar__cta">
          <Icon name="play" size={13} strokeWidth={2.4} />
          <span>Start a test</span>
        </Link>

        <nav className="sidebar__nav">
          {nav.groups.map((group) => (
            <div className="sidebar__group" key={group.title}>
              <span className="sidebar__group-title">{group.title}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `sidebar__item${isActive ? ' is-active' : ''}`}
                  title={item.hint ?? item.label}
                >
                  <span className="sidebar__icon">
                    <Icon name={item.icon} size={17} />
                  </span>
                  <span className="sidebar__label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__foot">
          <div className="sidebar__util">
            <DisplayMenu compact label="Display" />
          </div>
          {user.role === 'STUDENT' && coins !== null ? (
            <NavLink to="/learn/shop" className="coin-chip" title={boosted ? 'Coins — double XP is running' : 'Coins — spend them in the shop'}>
              <Icon name="coin" size={15} />
              <b>{coins.toLocaleString('en')}</b>
              {boosted ? <em>×2</em> : null}
            </NavLink>
          ) : null}
          <div className="sidebar__account">
            <button
              type="button"
              className={`sidebar__account-btn${accountOpen ? ' is-open' : ''}`}
              onClick={() => setAccountOpen((open) => !open)}
              aria-expanded={accountOpen}
              aria-haspopup="menu"
            >
              <span className="site-avatar">{initials(user.displayName)}</span>
              <span className="sidebar__account-text">
                <strong title={user.displayName}>{user.displayName}</strong>
                <span>{nav.label}</span>
              </span>
              <Icon name="chevronDown" size={14} className="sidebar__account-caret" />
            </button>
            {accountOpen ? (
              <div className="sidebar__account-menu" role="menu" aria-label="Account">
                {ACCOUNT_LINKS.map((item) => (
                  <NavLink key={item.to} to={item.to} className="menu-item" role="menuitem">
                    <Icon name={item.icon} size={16} />
                    {item.label}
                  </NavLink>
                ))}
                <button type="button" className="menu-item menu-item--button" onClick={signOut} role="menuitem">
                  <Icon name="logout" size={16} />
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      {/* Phone strip: the same controls the rail carries, at the top of the screen. */}
      <header className="appbar">
        <NavLink to={nav.home} className="appbar__brand" aria-label="Ai eo home">
          <BrandLogo theme="auto" height={26} />
        </NavLink>
        <div className="appbar__actions">
          {user.role === 'STUDENT' && coins !== null ? (
            <NavLink to="/learn/shop" className="coin-chip coin-chip--sm" aria-label={`${coins} coins, open the shop`}>
              <Icon name="coin" size={14} />
              <b>{coins.toLocaleString('en')}</b>
            </NavLink>
          ) : null}
          <DisplayMenu compact label="Display" />
          <button type="button" className="site-avatar site-avatar--sm" onClick={() => setAccountOpen((open) => !open)} aria-label="Account menu">
            {initials(user.displayName)}
          </button>
        </div>
      </header>

      <main className="site-main" id="main">
        <div className="route" key={location.pathname}>
          <Outlet />
        </div>
      </main>

      <SiteFooter role={user.role} compact />

      {accountOpen ? <div className="app-backdrop" onClick={() => setAccountOpen(false)} /> : null}

      <nav className="dock" aria-label="Main">
        {nav.tabs.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `dock__item${isActive ? ' is-active' : ''}`}>
            <span className="dock__icon">
              <Icon name={item.icon} size={19} />
            </span>
            <span>{item.label.split(' ')[0]}</span>
          </NavLink>
        ))}
        <button type="button" className={`dock__item${sheetOpen ? ' is-active' : ''}`} onClick={() => setSheetOpen((open) => !open)} aria-expanded={sheetOpen}>
          <span className="dock__icon">
            <Icon name="grid" size={19} />
          </span>
          <span>More</span>
        </button>
      </nav>

      {/* On a phone the account menu is a sheet: the sidebar it lives in on a
          desktop is not rendered at this width. */}
      {accountOpen ? (
        <>
          <div className="sheet-backdrop" onClick={() => setAccountOpen(false)} />
          <div className="sheet" role="dialog" aria-label="Account" aria-modal="true">
            <div className="sheet__handle" aria-hidden="true" />
            <div className="sheet__who">
              <span className="site-avatar site-avatar--lg">{initials(user.displayName)}</span>
              <span className="sheet__who-text">
                <strong>{user.displayName}</strong>
                <span>
                  {nav.label} · {user.email}
                </span>
              </span>
            </div>
            <div className="sheet__grid">
              {ACCOUNT_LINKS.map((item, index) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="sheet__tile"
                  style={{ ['--i' as string]: index }}
                >
                  <span className="sheet__tile-icon">
                    <Icon name={item.icon} size={18} />
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
            <div className="sheet__foot">
              <button type="button" className="menu-item menu-item--button" onClick={signOut}>
                <Icon name="logout" size={16} />
                Sign out
              </button>
            </div>
          </div>
        </>
      ) : null}

      {sheetOpen ? (
        <>
          <div className="sheet-backdrop" onClick={() => setSheetOpen(false)} />
          <div className="sheet" role="dialog" aria-label="All sections" aria-modal="true">
            <div className="sheet__handle" aria-hidden="true" />
            <div className="sheet__grid">
              {sheetItems.map((item, index) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `sheet__tile${isActive ? ' is-active' : ''}`}
                  style={{ ['--i' as string]: index }}
                >
                  <span className="sheet__tile-icon">
                    <Icon name={item.icon} size={18} />
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
            <div className="sheet__foot">
              <button type="button" className="menu-item menu-item--button" onClick={signOut}>
                <Icon name="logout" size={16} />
                Sign out
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
