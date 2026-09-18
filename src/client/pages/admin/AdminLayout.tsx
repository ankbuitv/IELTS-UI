import { NavLink, Outlet } from 'react-router-dom';

/**
 * Administration sub-navigation.
 *
 * The application shell already provides the top-level sidebar, so the admin
 * areas use a segmented sub-nav instead of stacking a second sidebar. That keeps
 * the content column wide enough for tables and editors.
 */
export function AdminLayout() {
  const links = [
    { to: '/admin', label: 'Dashboard', end: true },
    { to: '/admin/tests', label: 'Tests & content' },
    { to: '/admin/imports', label: 'Imports' },
    { to: '/admin/scoring-profiles', label: 'Scoring profiles' },
    { to: '/admin/attempts', label: 'Attempts' },
    { to: '/admin/users', label: 'Users' },
    { to: '/admin/settings', label: 'Settings' },
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Administration</h1>
          <p className="page-head__meta">
            Content, imports, scoring profiles, users and platform settings. Every change here is written to the audit
            log.
          </p>
        </div>
      </div>

      <nav className="subnav" aria-label="Administration sections">
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {link.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
