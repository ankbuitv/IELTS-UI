import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandLogo } from './BrandLogo';
import { DisplayMenu } from './DisplayMenu';
import { Icon, type IconName } from './Icon';
import { Button, Loading } from './ui';
import { initials } from '../lib/format';

/**
 * Application shell.
 *
 * A near-black top bar with the main places as text links (desktop) or a bottom
 * tab bar (below 960px), and one "More" panel that is a dropdown on a wide
 * screen and a bottom sheet on a phone. The standing disclaimer is a single
 * quiet line in the footer rather than a banner on every page.
 */
interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

/** Main places for a signed-in candidate, in the order they are used. */
const MAIN_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: 'grid' },
  { to: '/learn', label: 'Learn', icon: 'target' },
  { to: '/practice', label: 'Practice', icon: 'book' },
  { to: '/history', label: 'Results', icon: 'award' },
  { to: '/vocabulary', label: 'Vocabulary', icon: 'layers' },
  { to: '/dictionary', label: 'Dictionary', icon: 'search' },
];

/** Everything else lives behind "More". */
const MORE_NAV: NavItem[] = [
  { to: '/speaking', label: 'Speaking', icon: 'mic' },
  { to: '/analytics', label: 'My progress', icon: 'chart' },
  { to: '/classrooms', label: 'Classrooms', icon: 'users' },
  { to: '/profile', label: 'Profile', icon: 'user' },
];

/** The four phone tabs; the fifth opens the More sheet. */
const TAB_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: 'grid' },
  { to: '/learn', label: 'Learn', icon: 'target' },
  { to: '/practice', label: 'Practice', icon: 'book' },
  { to: '/vocabulary', label: 'Words', icon: 'layers' },
];

const PUBLIC_NAV = [
  { href: '#skills', label: 'Four skills' },
  { href: '#learn', label: 'Learn' },
  { href: '#marking', label: 'AI marking' },
  { href: '#teachers', label: 'For teachers' },
];

export function AppShell() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [panelOpen, setPanelOpen] = useState(false);

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

  const staff: NavItem[] = [];
  if (user?.role === 'TEACHER' || user?.role === 'ADMIN') {
    staff.push({ to: '/teacher', label: 'Teaching', icon: 'presentation' });
    staff.push({ to: '/teacher/marking', label: 'Mark writing', icon: 'pen' });
  }
  if (user?.role === 'ADMIN') staff.push({ to: '/admin', label: 'Administration', icon: 'shield' });

  const signOut = async () => {
    await logout();
    setPanelOpen(false);
    navigate('/');
  };

  const bleed = !user && location.pathname === '/';
  const moreActive = [...MORE_NAV, ...staff].some(
    (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
  );
  const inMainNav = MAIN_NAV.some((item) => location.pathname.startsWith(item.to));

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-header__inner">
          <NavLink to={user ? '/dashboard' : '/'} className="site-brand" aria-label="Ai eo home">
            <BrandLogo theme="dark" height={28} />
          </NavLink>

          {user ? (
            <nav className="site-nav" aria-label="Main">
              {MAIN_NAV.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                  {item.label}
                </NavLink>
              ))}
              <button
                type="button"
                className={`site-nav__more${moreActive && !inMainNav ? ' active' : ''}`}
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
              {location.pathname === '/'
                ? PUBLIC_NAV.map((item) => (
                    <a key={item.href} href={item.href}>
                      {item.label}
                    </a>
                  ))
                : null}
            </nav>
          )}

          <div className="site-actions">
            {user ? (
              <>
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

      <footer className="site-footer">
        <div className="site-footer__inner">
          <span className="site-footer__brand">Ai eo</span>
          <span>
            Independent practice platform. Not affiliated with IELTS, IDP, the British Council or Cambridge. Band
            scores are practice estimates, not official results.
          </span>
        </div>
      </footer>

      {user ? (
        <nav className="site-tabbar" aria-label="Main">
          {TAB_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `site-tabbar__item${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className={`site-tabbar__item${panelOpen || (moreActive && !TAB_NAV.some((i) => location.pathname.startsWith(i.to))) ? ' active' : ''}`}
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

            <div className="more-panel__group more-panel__group--phone">
              {MAIN_NAV.filter((item) => !TAB_NAV.some((tab) => tab.to === item.to)).map((item) => (
                <NavLink key={item.to} to={item.to} className="more-item" role="menuitem">
                  <Icon name={item.icon} size={17} />
                  {item.label}
                </NavLink>
              ))}
            </div>
            <div className="more-panel__group">
              {MORE_NAV.map((item) => (
                <NavLink key={item.to} to={item.to} className="more-item" role="menuitem">
                  <Icon name={item.icon} size={17} />
                  {item.label}
                </NavLink>
              ))}
            </div>
            {staff.length > 0 ? (
              <div className="more-panel__group">
                <div className="more-panel__label">Workspace</div>
                {staff.map((item) => (
                  <NavLink key={item.to} to={item.to} className="more-item" role="menuitem">
                    <Icon name={item.icon} size={17} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ) : null}
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
