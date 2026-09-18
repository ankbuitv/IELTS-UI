import { NavLink, Outlet } from 'react-router-dom';

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
    <div className="admin-layout">
      <nav className="admin-side" aria-label="Administration">
        <div className="admin-side__group">Administration</div>
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div>
        <Outlet />
      </div>
    </div>
  );
}
