import { Link } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';

/**
 * Slim footer — one short bar: brand, a handful of links, the legal note.
 * (The old three-column footer was heavy and noisy; this keeps every page's
 * bottom edge light.)
 */
interface FooterLink {
  label: string;
  to: string;
}

const SIGNED_OUT: FooterLink[] = [
  { label: 'Ôn luyện', to: '/#skills' },
  { label: 'Cách thi', to: '/#how' },
  { label: 'Câu hỏi', to: '/#faq' },
  { label: 'Blog', to: '/blog' },
  { label: 'Đăng nhập', to: '/login' },
];

const CANDIDATE: FooterLink[] = [
  { label: 'Luyện tập', to: '/practice' },
  { label: 'Speaking', to: '/speaking' },
  { label: 'Kết quả', to: '/history' },
  { label: 'Hồ sơ', to: '/profile' },
  { label: 'Blog', to: '/blog' },
];

const STAFF_EXTRA: FooterLink[] = [
  { label: 'Lớp & bài thi', to: '/teacher' },
  { label: 'Chấm Writing', to: '/teacher/marking' },
];

const MENTOR_EXTRA: FooterLink[] = [
  { label: 'Mentor', to: '/mentor' },
  { label: 'Lớp học', to: '/classes' },
  { label: 'Lịch hẹn', to: '/my-sessions' },
];

function linksFor(role: string | undefined): FooterLink[] {
  if (!role) return SIGNED_OUT;
  if (role === 'ADMIN') return [...MENTOR_EXTRA, ...STAFF_EXTRA, { label: 'Quản trị', to: '/admin' }].slice(0, 5);
  if (role === 'TEACHER') return [...STAFF_EXTRA, ...CANDIDATE].slice(0, 5);
  if (role === 'MENTOR') return [...MENTOR_EXTRA, CANDIDATE[3]!].slice(0, 5);
  return CANDIDATE;
}

export function SiteFooter({ role, compact = false }: { role?: string; compact?: boolean }) {
  const links = linksFor(role);
  const year = new Date().getFullYear();
  return (
    <footer className={`site-footer site-footer--slim${compact ? ' site-footer--compact' : ''}`}>
      <div className="site-footer__slim">
        <Link to="/" className="site-footer__slim-brand" aria-label="Ai eo — home">
          <BrandLogo theme="dark" height={24} />
          <span>Luyện IELTS như thi thật</span>
        </Link>
        <nav className="site-footer__slim-links" aria-label="Footer">
          {links.map((link) => (
            <Link key={link.to + link.label} to={link.to}>
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="site-footer__slim-note">
          © {year} Ai eo · Điểm luyện tập là ước tính, không phải kết quả IELTS chính thức.
        </p>
      </div>
    </footer>
  );
}
