import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandLogo } from './BrandLogo';
import { Icon, type IconName } from './Icon';
import { Button, Loading } from './ui';
import { initials } from '../lib/format';

/**
 * Application shell.
 *
 * Desktop gets a light sticky sidebar (navigation) and a light top bar (account
 * context); below 1024px the sidebar becomes a drawer so the exam and dashboard
 * pages keep the full viewport width. Every navigation item carries an icon so
 * the rail can be scanned rather than read.
 */
interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const PAGE_TITLES: Array<[prefix: string, title: string]> = [
  ['/admin', 'Administration'],
  ['/teacher/marking', 'Mark writing'],
  ['/teacher', 'Teaching'],
  ['/dashboard', 'Dashboard'],
  ['/practice', 'Practice tests'],
  ['/history', 'My attempts'],
  ['/exam', 'Exam in progress'],
  ['/classrooms', 'Classrooms'],
  ['/analytics', 'My progress'],
  ['/profile', 'Profile'],
];

function pageTitle(pathname: string): string {
  for (const [prefix, title] of PAGE_TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title;
  }
  return 'Ai eo workspace';
}

export function AppShell() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // The drawer must not stay open when the layout switches back to the desktop
  // sidebar, otherwise the backdrop would cover a page that has a visible rail.
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1025px)');
    const close = () => {
      if (media.matches) setDrawerOpen(false);
    };
    close();
    media.addEventListener('change', close);
    return () => media.removeEventListener('change', close);
  }, []);

  if (loading) {
    return (
      <div className="app-shell">
        <Loading label="Checking your session…" />
      </div>
    );
  }

  const primary: NavItem[] = [];
  const workspace: NavItem[] = [];
  if (user) {
    primary.push({ to: '/dashboard', label: 'Dashboard', icon: 'grid' });
    primary.push({ to: '/practice', label: 'Practice tests', icon: 'book' });
    primary.push({ to: '/history', label: 'My attempts', icon: 'clock' });
    primary.push({ to: '/classrooms', label: 'Classrooms', icon: 'users' });
    primary.push({ to: '/analytics', label: 'My progress', icon: 'chart' });
    primary.push({ to: '/profile', label: 'Profile', icon: 'user' });
  }
  if (user?.role === 'TEACHER' || user?.role === 'ADMIN') {
    workspace.push({ to: '/teacher', label: 'Teaching', icon: 'presentation' });
    workspace.push({ to: '/teacher/marking', label: 'Mark writing', icon: 'pen' });
  }
  if (user?.role === 'ADMIN') {
    workspace.push({ to: '/admin', label: 'Administration', icon: 'shield' });
  }

  // The top bar is context, not navigation: on small screens the sidebar is a
  // drawer, so it also carries the brand and the menu button.
  const brand = (
    <NavLink to={user ? '/dashboard' : '/'} className="sidebar__brand" aria-label="Ai eo home">
      <span className="brand-logo">
        <BrandLogo height={34} />
      </span>
    </NavLink>
  );

  const signOut = async () => {
    await logout();
    navigate('/');
  };

  /**
   * Navigation is rendered twice (sticky sidebar for desktop, drawer for small
   * screens) so both share one source of truth. Exactly one is visible at a
   * time thanks to the media queries in globals.css.
   */
  const navBody = (
    <>
      {primary.length > 0 ? (
        <>
          <div className="sidebar__section">Study</div>
          <nav className="sidebar__nav" aria-label="Study">
            {primary.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) => `sidebar__link${isActive ? ' active' : ''}`}
              >
                <Icon name={item.icon} size={17} className="sidebar__icon" />
                <span className="sidebar__label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </>
      ) : null}

      {workspace.length > 0 ? (
        <>
          <div className="sidebar__section">Workspace</div>
          <nav className="sidebar__nav" aria-label="Workspace">
            {workspace.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) => `sidebar__link${isActive ? ' active' : ''}`}
              >
                <Icon name={item.icon} size={17} className="sidebar__icon" />
                <span className="sidebar__label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </>
      ) : null}

      <div className="sidebar__spacer" />

      <div className="sidebar__footer">
        {user ? (
          <div className="user-card">
            <span className="avatar" aria-hidden="true">
              {initials(user.displayName)}
            </span>
            <span className="user-card__body">
              <span className="user-card__name" title={user.displayName}>
                {user.displayName}
              </span>
              <span className="user-card__role">{user.role.toLowerCase()}</span>
            </span>
            <button type="button" className="user-card__action" onClick={signOut} aria-label="Sign out" title="Sign out">
              <Icon name="logout" size={16} />
            </button>
          </div>
        ) : (
          <div className="row">
            <Button size="sm" variant="ghost" block onClick={() => navigate('/login')}>
              Sign in
            </Button>
            <Button size="sm" variant="primary" block onClick={() => navigate('/register')}>
              Create account
            </Button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className={`shell ${user ? '' : 'shell--public'}`}>
      <aside className="shell__sidebar">
        {brand}
        {navBody}
      </aside>

      {drawerOpen ? (
        <div className="drawer-backdrop drawer-backdrop--open" onClick={() => setDrawerOpen(false)} />
      ) : null}
      <div
        className={`drawer${drawerOpen ? ' drawer--open' : ''}`}
        role="dialog"
        aria-label="Navigation"
        aria-hidden={!drawerOpen}
        style={{ visibility: drawerOpen ? 'visible' : 'hidden' }}
      >
        {brand}
        {navBody}
      </div>

      <div className="shell__main">
        <header className="topbar">
          <button
            type="button"
            className="hamburger"
            aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <Icon name={drawerOpen ? 'close' : 'menu'} size={20} />
          </button>

          {user ? (
            <>
              <span className="topbar__context">
                <span className="topbar__title">{pageTitle(location.pathname)}</span>
                <span className="topbar__meta topbar__meta--role">{user.displayName}</span>
              </span>
              <div className="topbar__actions">
                <NavLink to="/practice" className="btn btn--sm btn--primary">
                  <Icon name="play" size={14} />
                  Start practising
                </NavLink>
                <span className="topbar__divider" aria-hidden="true" />
                <span className="avatar avatar--sm" aria-hidden="true">
                  {initials(user.displayName)}
                </span>
                <Button size="sm" variant="ghost" onClick={signOut}>
                  Sign out
                </Button>
              </div>
            </>
          ) : (
            <>
              <NavLink to="/" className="topbar__brand" aria-label="Ai eo home">
                <span className="brand-logo">
                  <BrandLogo height={30} />
                </span>
              </NavLink>
              <nav className="topbar__links" aria-label="Site">
                <a href="#skills">Skills</a>
                <a href="#teachers">For teachers</a>
                <a href="#features">Features</a>
              </nav>
              <div className="topbar__actions">
                <Button size="sm" variant="ghost" onClick={() => navigate('/login')}>
                  Sign in
                </Button>
                <Button size="sm" variant="primary" onClick={() => navigate('/register')}>
                  Create account
                </Button>
              </div>
            </>
          )}
        </header>

        <main className="app-main">
          <Outlet />
        </main>

        <footer className="shell__content site-footnote" style={{ paddingTop: 0 }}>
          <div className="footer-brand" aria-hidden="true">
            <span className="brand-logo">
              <BrandLogo height={22} />
            </span>
          </div>
          <p className="tiny muted" style={{ maxWidth: 900, margin: 0 }}>
            Ai eo provides independent English practice. It is not affiliated with, endorsed by or connected to IELTS,
            the British Council, IDP or Cambridge, and it does not reproduce their materials or branding. Scores and
            bands shown here are practice indications only.
          </p>
        </footer>
      </div>
    </div>
  );
}
