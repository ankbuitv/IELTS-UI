import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandLogo } from './BrandLogo';
import { Button, Loading } from './ui';
import { initials } from '../lib/format';

/**
 * Application shell.
 *
 * Desktop: a quiet white sidebar (navigation) plus a light top bar (context and
 * account actions). Tablet and phone: the sidebar becomes a drawer so the exam
 * and dashboard pages keep the full viewport width.
 */
interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export function AppShell() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
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
    primary.push({ to: '/dashboard', label: 'Dashboard' });
    primary.push({ to: '/practice', label: 'Practice tests' });
    primary.push({ to: '/history', label: 'My attempts' });
    primary.push({ to: '/classrooms', label: 'Classrooms' });
    primary.push({ to: '/analytics', label: 'My progress' });
    primary.push({ to: '/profile', label: 'Profile' });
  }
  if (user?.role === 'TEACHER' || user?.role === 'ADMIN') {
    workspace.push({ to: '/teacher', label: 'Teaching' });
  }
  if (user?.role === 'ADMIN') {
    workspace.push({ to: '/admin', label: 'Administration' });
  }

  const brand = (
    <NavLink to={user ? '/dashboard' : '/'} className="sidebar__brand" aria-label="Ai eo home">
      <span className="brand-logo">
        {/* Dark wordmark variant: the sidebar rail is a deep surface. */}
        <BrandLogo theme="dark" height={38} />
      </span>
    </NavLink>
  );

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
                {item.label}
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
                {item.label}
              </NavLink>
            ))}
          </nav>
        </>
      ) : null}
      <div className="sidebar__spacer" />
      <div className="sidebar__footer">
        {user ? (
          <div className="row row--between">
            <span className="tiny muted nowrap" title={user.email}>
              <strong style={{ color: 'var(--ink-700)' }}>{initials(user.displayName)}</strong> · {user.role.toLowerCase()}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <div className="row">
            <Button size="sm" variant="ghost" onClick={() => navigate('/login')}>
              Sign in
            </Button>
            <Button size="sm" variant="primary" onClick={() => navigate('/register')}>
              Create account
            </Button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className={`shell ${user ? '' : 'shell--public'}`}>
      <aside className="shell__sidebar">{brand}{navBody}</aside>

      {drawerOpen ? <div className="drawer-backdrop drawer-backdrop--open" onClick={() => setDrawerOpen(false)} /> : null}
      <div
        className={`drawer${drawerOpen ? ' drawer--open' : ''}`}
        aria-hidden={!drawerOpen}
        style={{ visibility: drawerOpen ? 'visible' : 'hidden' }}
      >
        {brand}
        {navBody}
      </div>

      <div className="shell__main">
        <header className="topbar">
          <button type="button" className="hamburger" aria-label="Open navigation" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
            ☰
          </button>
          <NavLink to={user ? '/dashboard' : '/'} className="topbar__brand" aria-label="Ai eo home">
            <span className="brand-logo">
              <BrandLogo height={30} />
            </span>
          </NavLink>
          {user ? (
            <span className="topbar__meta topbar__meta--role">Signed in as {user.displayName}</span>
          ) : (
            <nav className="topbar__links" aria-label="Site">
              <a href="#skills">Skills</a>
              <a href="#teachers">For teachers</a>
              <a href="#features">Features</a>
            </nav>
          )}
          <div className="topbar__actions">
            {user ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await logout();
                  navigate('/');
                }}
              >
                Sign out
              </Button>
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
        </header>

        <main className="app-main">
          <Outlet />
        </main>

        <footer className="shell__content" style={{ paddingTop: 0 }}>
          <div className="footer-brand" aria-hidden="true">
            <span className="brand-logo">
              <BrandLogo height={24} />
            </span>
          </div>
          <p className="tiny muted" style={{ maxWidth: 900, margin: 0 }}>
            Ai eo provides independent English practice. It is not affiliated with, endorsed by or
            connected to IELTS, the British Council, IDP or Cambridge, and it does not reproduce their materials or
            branding. Scores and bands shown here are practice indications only.
          </p>
        </footer>
      </div>
    </div>
  );
}
