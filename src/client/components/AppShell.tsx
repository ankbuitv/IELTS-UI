import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { boostState } from '@shared/shop';
import { useAuth } from '../context/AuthContext';
import { learnApi } from '../lib/learn-api';
import { api } from '../lib/api';
import { BrandLogo, BrandMark } from './BrandLogo';
import { DisplayMenu } from './DisplayMenu';
import { Icon, type IconName } from './Icon';
import { SiteFooter } from './SiteFooter';
import { Button, Loading } from './ui';
import { UserAvatar } from './UserAvatar';
import { SearchPalette } from './SearchPalette';
import { NotificationBell } from './NotificationBell';

/**
 * Application shell.
 *
 * Signed in, the desktop gets a narrow icon rail — Home, Practice, Learn,
 * Results, Classes and "More" — six icons only, with the name of each place
 * revealed on hover. "More" opens the full menu of every other destination,
 * kept in its groups. The slim top bar carries the search, the wallet chips,
 * the display menu and the avatar. Phones keep the bottom tab bar and the one
 * "More" sheet. Public pages use the marketing top nav instead.
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

/** Main places for a signed-in candidate, grouped so same-kind places sit together. */
const LEARN_GROUP: NavGroup = {
  label: 'Học tập',
  items: [
    { to: '/dashboard', label: 'Trang chủ', icon: 'home' },
    { to: '/learn', label: 'Lộ trình học', icon: 'target' },
    { to: '/learn/plan', label: 'Kế hoạch học', icon: 'calendar' },
    { to: '/calendar', label: 'Lịch học', icon: 'calendar' },
    { to: '/practice', label: 'Luyện thi', icon: 'book' },
    { to: '/drills', label: 'Ôn dạng bài', icon: 'target' },
    { to: '/lab/dictation', label: 'Luyện nghe chép', icon: 'headphones' },
    { to: '/lab/pronunciation', label: 'Phát âm', icon: 'volume' },
    { to: '/history', label: 'Kết quả', icon: 'award' },
    { to: '/vocabulary', label: 'Từ vựng', icon: 'layers' },
    { to: '/tutor', label: 'AI Gia sư', icon: 'sparkle' },
    { to: '/dictionary', label: 'Từ điển', icon: 'search' },
  ],
};

/** Coaching: book a coach, upcoming calls, and every classroom in one place. */
const COACHING_GROUP: NavGroup = {
  label: 'Cố vấn & lớp học',
  items: [
    { to: '/mentors', label: 'Tìm cố vấn', icon: 'graduation' },
    { to: '/my-sessions', label: 'Buổi học của tôi', icon: 'video' },
    { to: '/classes', label: 'Lớp trực tiếp', icon: 'users' },
    { to: '/classrooms', label: 'Lớp của tôi', icon: 'presentation' },
  ],
};

const GROW_GROUP: NavGroup = {
  label: 'Phát triển',
  items: [
    { to: '/speaking', label: 'Luyện Nói', icon: 'mic' },
    { to: '/speaking/partner', label: 'Bạn tập AI', icon: 'sparkle' },
    { to: '/analytics', label: 'Tiến trình', icon: 'chart' },
  ],
};

const REWARDS_GROUP: NavGroup = {
  label: 'Phần thưởng',
  items: [
    { to: '/learn/shop', label: 'Cửa hàng', icon: 'cart' },
    { to: '/learn/leaderboard', label: 'Bảng xếp hạng', icon: 'trophy' },
    { to: '/season', label: 'Season pass', icon: 'crown' },
    { to: '/study-groups', label: 'Nhóm học', icon: 'users' },
    { to: '/study-room', label: 'Phòng học', icon: 'clock' },
    { to: '/learn/friends', label: 'Bạn bè', icon: 'heart' },
    { to: '/pricing', label: 'Gói & Pro', icon: 'coin' },
    { to: '/profile', label: 'Hồ sơ', icon: 'user' },
  ],
};

const MENTOR_GROUP: NavGroup = {
  label: 'Cố vấn',
  items: [
    { to: '/mentor', label: 'Bảng điều khiển', icon: 'presentation' },
    { to: '/my-sessions', label: 'Buổi học', icon: 'video' },
    { to: '/classes', label: 'Lớp của tôi', icon: 'users' },
    { to: '/mentors', label: 'Danh sách cố vấn', icon: 'graduation' },
    { to: '/training', label: 'Đào tạo', icon: 'bulb' },
  ],
};

/** The four phone tabs for a candidate; the fifth opens the More sheet. */
const TAB_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Trang chủ', icon: 'home' },
  { to: '/learn', label: 'Học tập', icon: 'target' },
  { to: '/mentors', label: 'Cố vấn', icon: 'graduation' },
  { to: '/practice', label: 'Luyện thi', icon: 'book' },
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
          label: 'Quản lý',
          items: [
            { to: '/admin', label: 'Bảng quản trị', icon: 'shield' },
            { to: '/teacher', label: 'Giảng dạy', icon: 'presentation' },
            { to: '/teacher/marking', label: 'Hàng chấm bài', icon: 'pen' },
            { to: '/training', label: 'Đào tạo', icon: 'bulb' },
          ],
        },
        LEARN_GROUP,
        COACHING_GROUP,
        GROW_GROUP,
        REWARDS_GROUP,
      ],
      tabs: [
        { to: '/admin', label: 'Quản trị', icon: 'shield' },
        { to: '/teacher', label: 'Giảng dạy', icon: 'presentation' },
        { to: '/learn', label: 'Học tập', icon: 'target' },
        { to: '/practice', label: 'Luyện thi', icon: 'book' },
      ],
      home: '/admin',
    };
  }
  if (role === 'TEACHER') {
    return {
      groups: [
        {
          label: 'Giảng dạy',
          items: [
            { to: '/teacher', label: 'Bảng giảng dạy', icon: 'presentation' },
            { to: '/teacher/marking', label: 'Hàng chấm bài', icon: 'pen' },
            { to: '/training', label: 'Đào tạo', icon: 'bulb' },
            { to: '/practice', label: 'Luyện thi', icon: 'book' },
            { to: '/learn', label: 'Lộ trình học', icon: 'target' },
          ],
        },
        COACHING_GROUP,
        GROW_GROUP,
        REWARDS_GROUP,
      ],
      tabs: [
        { to: '/teacher', label: 'Giảng dạy', icon: 'presentation' },
        { to: '/teacher/marking', label: 'Chấm bài', icon: 'pen' },
        { to: '/learn', label: 'Học tập', icon: 'target' },
        { to: '/practice', label: 'Luyện thi', icon: 'book' },
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
        { to: '/mentor', label: 'Bảng điều khiển', icon: 'presentation' },
        { to: '/my-sessions', label: 'Buổi học', icon: 'video' },
        { to: '/classes', label: 'Lớp học', icon: 'users' },
        { to: '/practice', label: 'Luyện thi', icon: 'book' },
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

/** Role names the way a Vietnamese learner reads them. */
const ROLE_LABELS: Record<string, string> = { STUDENT: 'Học viên', TEACHER: 'Giáo viên', MENTOR: 'Cố vấn', ADMIN: 'Quản trị' };

export function AppShell() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelOrigin, setPanelOrigin] = useState<'sidebar' | 'topbar' | 'tabbar' | 'more'>('topbar');
  const [coins, setCoins] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const [xp, setXp] = useState<number | null>(null);
  const [boosted, setBoosted] = useState(false);
  const heartbeatUserId = user?.id;

  // The icon rail is a desktop (≥1080px) affordance: on phones the six places
  // are the tab bar plus the "More" sheet, so "More" shows the tab set's rest.
  const [railVisible, setRailVisible] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1080px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1080px)');
    const onChange = () => setRailVisible(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

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
        <Loading label="Đang kiểm tra phiên đăng nhập…" />
      </div>
    );
  }

  const nav = navFor(user?.role);
  // The rail: six icon-only places, name shown on hover. Everything else is
  // behind "More", which groups what is left so many features stay scannable.
  const railItems: NavItem[] = [
    { to: nav.home, label: 'Trang chủ', icon: 'home' },
    { to: '/practice', label: 'Luyện thi', icon: 'book' },
    { to: '/learn', label: 'Học tập', icon: 'target' },
    { to: '/history', label: 'Kết quả', icon: 'award' },
    { to: '/classes', label: 'Lớp học', icon: 'users' },
  ];
  const railSet = new Set(railItems.map((item) => item.to));
  // What "More" holds back: the rail on desktop, the four tabs on phones.
  const heldBack = railVisible ? railSet : new Set(nav.tabs.map((tab) => tab.to));
  const overflowGroups = nav.groups
    .map((group) => ({ label: group.label, items: group.items.filter((item) => !heldBack.has(item.to)) }))
    .filter((group) => group.items.length > 0);
  const overflowNav = overflowGroups.flatMap((group) => group.items);

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
          <NavLink to={nav.home} className="app-sidebar__brand" aria-label="Ai eo — Trang chủ" title="Ai eo">
            <BrandMark theme="light" size={26} />
          </NavLink>

          <nav className="app-sidebar__nav" aria-label="Chính">
            {railItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                data-label={item.label}
                aria-label={item.label}
                className={({ isActive }) => `app-nav-item${isActive ? ' active' : ''}`}
              >
                <Icon name={item.icon} size={20} />
              </NavLink>
            ))}
            <button
              type="button"
              data-label="Thêm"
              aria-label="Thêm"
              aria-haspopup="menu"
              aria-expanded={panelOpen}
              className={`app-nav-item app-nav-item--more${panelOpen && panelOrigin === 'sidebar' ? ' active' : ''}`}
              onClick={() => {
                setPanelOrigin('sidebar');
                setPanelOpen((open) => !open);
              }}
            >
              <Icon name="menu" size={20} />
            </button>
          </nav>
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
                  onClick={() => {
                    setPanelOrigin('more');
                    setPanelOpen((open) => !open);
                  }}
                >
                  Thêm
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
                  <button type="button" className="site-search" onClick={() => setSearchOpen(true)} aria-label="Tìm bài thi, bài học, cố vấn">
                    <Icon name="search" size={15} />
                    Tìm bài học, từ vựng, cố vấn…
                  </button>
                  {user.role === 'STUDENT' && coins !== null ? (
                    <>
                      <NavLink
                        to="/learn/shop"
                        className="wallet-chip"
                        title={boosted ? 'Xu — ×2 XP đang chạy' : 'Xu — dùng trong cửa hàng'}
                        aria-label={`${coins} xu, mở cửa hàng`}
                      >
                        <Icon name="coin" size={14} />
                        <b>{coins.toLocaleString('en')}</b>
                        {boosted ? <em>×2</em> : null}
                      </NavLink>
                      <span className="wallet-chip wallet-chip--streak" title="Chuỗi ngày">
                        <Icon name="flame" size={14} filled />
                        <b>{streak ?? 0}</b>
                      </span>
                    </>
                  ) : null}
                  <NotificationBell />
                  <DisplayMenu compact label="Display" />
                  <NavLink to="/practice" className="btn btn--sm btn--primary site-cta">
                    <Icon name="play" size={12} />
                    <span>Bắt đầu thi</span>
                  </NavLink>
                  <button
                    type="button"
                    className="site-avatar-btn"
                    title={user.displayName}
                    aria-label="Account menu"
                    aria-expanded={panelOpen}
                    onClick={() => {
                      setPanelOrigin('topbar');
                      setPanelOpen((open) => !open);
                    }}
                  >
                    <UserAvatar src={user.avatarUrl} userId={user.id} name={user.displayName} size={38} />
                  </button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => navigate('/login')}>
                    Đăng nhập
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => navigate('/register')}>
                    Tạo tài khoản
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>

        <main className={`site-main${bleed ? ' site-main--bleed' : ''}`}>
          <Outlet />
        </main>

        <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
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
            onClick={() => {
              setPanelOrigin('tabbar');
              setPanelOpen((open) => !open);
            }}
            aria-expanded={panelOpen}
          >
            <Icon name="menu" size={20} />
            <span>Thêm</span>
          </button>
        </nav>
      ) : null}

      {user && panelOpen ? (
        <>
          <div className="more-backdrop" onClick={() => setPanelOpen(false)} />
          <div className={`more-panel more-panel--${panelOrigin}`} role="menu" aria-label="Thêm">
            <div className="more-panel__who">
              <UserAvatar src={user.avatarUrl} userId={user.id} name={user.displayName} size={44} />
              <span className="more-panel__who-text">
                <strong title={user.displayName}>{user.displayName}</strong>
                <span>{ROLE_LABELS[user.role] ?? user.role}</span>
              </span>
            </div>

            {overflowGroups.map((group) => (
              <div key={group.label} className="more-panel__group">
                <span className="more-panel__label">{group.label}</span>
                {group.items.map((item) => (
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
            ))}
            <div className="more-panel__group">
              <button type="button" className="more-item more-item--button" onClick={signOut} role="menuitem">
                <Icon name="logout" size={17} />
                Đăng xuất
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
