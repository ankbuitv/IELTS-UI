import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, Loading } from './ui';
import { initials } from '../lib/format';

export function AppShell() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="app-shell">
        <Loading label="Checking your session…" />
      </div>
    );
  }

  const links: Array<{ to: string; label: string }> = [];
  if (user?.role === 'STUDENT' || user?.role === 'TEACHER' || user?.role === 'ADMIN') {
    links.push({ to: '/dashboard', label: 'Dashboard' });
    links.push({ to: '/practice', label: 'Practice tests' });
  }
  if (user?.role === 'TEACHER' || user?.role === 'ADMIN') {
    links.push({ to: '/teacher', label: 'Teaching' });
  }
  if (user?.role === 'ADMIN') {
    links.push({ to: '/admin', label: 'Administration' });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <NavLink to={user ? '/dashboard' : '/'} className="brand">
            <span className="brand__mark">MT</span>
            <span>
              Meridian
              <span className="brand__sub">Test Studio</span>
            </span>
          </NavLink>

          <nav className="app-nav" aria-label="Primary">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="app-header__spacer">
            {user ? (
              <>
                <span className="tiny muted nowrap" title={user.email}>
                  <strong style={{ color: 'var(--ink-700)' }}>{initials(user.displayName)}</strong> ·{' '}
                  {user.role.toLowerCase()}
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

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-main" style={{ paddingTop: 0, paddingBottom: 24 }}>
        <p className="tiny muted" style={{ maxWidth: 900 }}>
          Meridian Test Studio provides independent IELTS-style practice. It is not affiliated with, endorsed by or
          connected to IELTS, the British Council, IDP or Cambridge, and it does not reproduce their materials or
          branding. Scores and bands shown here are practice indications only.
        </p>
      </footer>
    </div>
  );
}
