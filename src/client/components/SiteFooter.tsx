import { Link } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';

/**
 * The footer shared by the public pages and the signed-in app: brand and tagline on the left,
 * three short link columns on the right, and the standing disclaimer on its own line. Every link
 * is a real route or a landing-page section, so the footer never points at a page that is not there.
 */
interface FooterLink {
  label: string;
  /** A route (`/practice`) or a landing-page section (`/#skills`). */
  to: string;
}

interface FooterColumn {
  title: string;
  links: FooterLink[];
}

const SIGNED_OUT: FooterColumn[] = [
  {
    title: 'Practise',
    links: [
      { label: 'Four skills', to: '/#skills' },
      { label: 'How a test works', to: '/#how' },
      { label: 'Exam conditions', to: '/#exam' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { label: 'Learning path', to: '/#learn' },
      { label: 'AI marking', to: '/#marking' },
      { label: 'Questions', to: '/#faq' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign in', to: '/login' },
      { label: 'Create account', to: '/register' },
      { label: 'For teachers', to: '/#teachers' },
    ],
  },
];

const CANDIDATE: FooterColumn[] = [
  {
    title: 'Practise',
    links: [
      { label: 'Practice tests', to: '/practice' },
      { label: 'Speaking', to: '/speaking' },
      { label: 'Results', to: '/history' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { label: 'Learning path', to: '/learn' },
      { label: 'Vocabulary', to: '/vocabulary' },
      { label: 'Dictionary', to: '/dictionary' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'My progress', to: '/analytics' },
      { label: 'Classrooms', to: '/classrooms' },
      { label: 'Profile', to: '/profile' },
    ],
  },
];

const TEACHER: FooterColumn = {
  title: 'Teaching',
  links: [
    { label: 'Classes and tests', to: '/teacher' },
    { label: 'Writing queue', to: '/teacher/marking' },
    { label: 'Profile', to: '/profile' },
  ],
};

const ADMIN: FooterColumn = {
  title: 'Admin',
  links: [
    { label: 'Console', to: '/admin' },
    { label: 'Classes and tests', to: '/teacher' },
    { label: 'Writing queue', to: '/teacher/marking' },
  ],
};

function columnsFor(role: string | undefined): FooterColumn[] {
  if (!role) return SIGNED_OUT;
  if (role === 'ADMIN') return [ADMIN, CANDIDATE[0]!, CANDIDATE[1]!];
  if (role === 'TEACHER') return [TEACHER, CANDIDATE[0]!, CANDIDATE[1]!];
  return CANDIDATE;
}

export function SiteFooter({ role, compact = false }: { role?: string; compact?: boolean }) {
  const columns = columnsFor(role);
  const year = new Date().getFullYear();
  return (
    <footer className={`site-footer${compact ? ' site-footer--compact' : ''}`}>
      <div className="site-footer__inner">
        <div className="site-footer__top">
          <div className="site-footer__brand">
            <BrandLogo theme="dark" height={34} />
            <p className="site-footer__tagline">Luyện IELTS như thi thật.</p>
            {compact ? null : (
              <p className="site-footer__about">
                Full-length practice tests under exam conditions, two AI judges for Writing and Speaking, and a short
                daily path for vocabulary. Made for learners in Vietnam.
              </p>
            )}
          </div>
          {columns.map((column) => (
            <nav key={column.title} className="site-footer__col" aria-label={column.title}>
              <h2>{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link to={link.to}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="site-footer__bottom">
          <p>
            Ai eo is an independent practice platform. It is not affiliated with, endorsed by or connected to IELTS,
            IDP, the British Council or Cambridge. Band scores are practice estimates, not official results.
          </p>
          <span className="site-footer__made">© {year} Ai eo</span>
        </div>
      </div>
    </footer>
  );
}
