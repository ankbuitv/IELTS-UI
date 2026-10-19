import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon } from '../../components/Icon';

/**
 * Administration sub-navigation.
 *
 * The application shell already provides the top-level sidebar, so the admin
 * areas use a segmented sub-nav instead of stacking a second sidebar. A second
 * page title would compete with the page being edited, so the area label is a
 * slim context bar that sticks to the top of the content column, and each
 * section below keeps its own heading.
 */
const LINKS = [
  { to: '/admin', label: 'Dashboard', icon: 'chart', end: true },
  { to: '/admin/tests', label: 'Tests & content', icon: 'file', end: false },
  { to: '/admin/imports', label: 'Imports', icon: 'upload', end: false },
  { to: '/admin/scoring-profiles', label: 'Scoring profiles', icon: 'target', end: false },
  { to: '/admin/attempts', label: 'Attempts', icon: 'list', end: false },
  { to: '/admin/learn', label: 'Learn content', icon: 'book', end: false },
  { to: '/admin/writing', label: 'Writing', icon: 'pen', end: false },
  { to: '/admin/users', label: 'Users', icon: 'users', end: false },
  { to: '/admin/settings', label: 'Settings', icon: 'settings', end: false },
] as const;

export function AdminLayout() {
  const { pathname } = useLocation();
  const current = LINKS.filter((link) => (link.end ? pathname === link.to : pathname.startsWith(link.to))).at(-1);

  return (
    <div className="stack admin-console">
      <div className="admin-context">
        <p className="admin-context__label">
          <span className="admin-context__shield" aria-hidden="true">
            <Icon name="shield" size={13} />
          </span>
          Administration
          <span className="admin-context__crumb">/ {current?.label ?? 'Dashboard'}</span>
        </p>
        <nav className="admin-sub" aria-label="Administration sections">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => `admin-sub__tab${isActive ? ' is-on' : ''}`}
            >
              <Icon name={link.icon} size={14} />
              {link.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Outlet />
    </div>
  );
}
