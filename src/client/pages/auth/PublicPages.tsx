import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { BrandLogo } from '../../components/BrandLogo';
import { Button, Field, Notice, PasswordInput, TextInput } from '../../components/ui';
import { api, describeError } from '../../lib/api';

export function LandingPage() {
  const { user } = useAuth();
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="public-page">
      <section className="public-hero">
        <div className="public-hero__inner">
          <div>
            <span className="public-hero__eyebrow">Independent practice platform</span>
            <h1>Computer-based exam practice, classroom management and full mock tests.</h1>
            <p>
              Ai eo gives teachers one workflow for original Reading, Listening and Writing practice:
              server-marked results, assigned deadlines, class analytics and integrity monitoring that is honest about
              what a browser can and cannot observe.
            </p>
            <div className="public-hero__actions">
              <Link className="btn btn--primary btn--lg" to="/register">
                Create a free student account
              </Link>
              <Link className="btn btn--lg" to="/login">
                Sign in
              </Link>
            </div>
            <p className="public-hero__note">
              No credit card, no trial timer. Teachers are created by an administrator or by signing up with an
              institution code.
            </p>
          </div>

          <div className="public-hero__card">
            <h2>What a session looks like</h2>
            <p className="tiny muted" style={{ marginBottom: 0 }}>
              The same shell from practice to a full mock: passage on the left, questions on the right, a timer the
              server controls.
            </p>
            <div className="hero-preview">
              <div className="hero-preview__row">
                <span className="skill-chip skill-reading">Reading</span>
                <span>Passage + 13 questions</span>
                <span className="hero-preview__badge">40 min</span>
              </div>
              <div className="hero-preview__row">
                <span className="skill-chip skill-listening">Listening</span>
                <span>Audio panel + note completion</span>
                <span className="hero-preview__badge">30 min</span>
              </div>
              <div className="hero-preview__row">
                <span className="skill-chip skill-writing">Writing</span>
                <span>Task 1 and Task 2 with word counts</span>
                <span className="hero-preview__badge">60 min</span>
              </div>
              <div className="hero-preview__row">
                <span className="skill-chip skill-mock">Full mock</span>
                <span>Listening → Reading → Writing</span>
                <span className="hero-preview__badge">Sequence</span>
              </div>
            </div>
            <p className="tiny muted" style={{ marginTop: 14, marginBottom: 0 }}>
              Estimated bands are a practice signal, never an official IELTS result.
            </p>
          </div>
        </div>
      </section>

      <section className="public-section" id="skills">
        <div className="public-section__head">
          <h2>Four skills, one consistent exam shell</h2>
          <p>
            Each skill keeps its own colour across the dashboards and analytics, so a class report can be read at a
            glance without relying on a single hue.
          </p>
        </div>
        <div className="grid grid--4">
          <SkillCard
            skill="reading"
            name="Reading"
            detail="TRUE/FALSE/NOT GIVEN, matching headings and information, completion and short answer tasks, with a readability-first passage pane."
            meta="40 questions · 60 min"
          />
          <SkillCard
            skill="listening"
            name="Listening"
            detail="A calm audio panel with policy-driven play limits, section information and note, table and sentence completion."
            meta="40 questions · 30 min"
          />
          <SkillCard
            skill="writing"
            name="Writing"
            detail="Task 1 and Task 2 with autosave, live word counts, prompt cards and human marking by a teacher."
            meta="2 tasks · 60 min"
          />
          <SkillCard
            skill="mock"
            name="Full mock"
            detail="Listening, Reading and Writing in sequence with a clear progression indicator and server-controlled section timing."
            meta="Complete test"
          />
        </div>
      </section>

      <section className="public-section public-section--muted" id="teachers">
        <div className="public-section__inner">
          <div className="public-section__head">
            <h2>Built for teachers, not for a leaderboard</h2>
            <p>
              Classrooms, assignments and reports designed to be scanned: alignment, whitespace, status badges and
              filters rather than a wall of numbers.
            </p>
          </div>
          <div className="grid grid--3">
            <Feature icon="🏫" title="Classrooms and secure invitations">
              Create a classroom, share a single-use invitation code, enrol by email and keep every class isolated.
              Teachers can only ever read their own classes and students.
            </Feature>
            <Feature icon="🗓" title="Assignments with real rules">
              Assign a published version with a deadline, attempt limit, timing policy and result-release policy
              (immediate, score only, after the deadline or no review).
            </Feature>
            <Feature icon="📈" title="Reports that stay honest">
              Class analytics, band distributions, task-type accuracy and integrity summaries. Observable events are
              recorded, never declared as proof of cheating.
            </Feature>
          </div>
        </div>
      </section>

      <section className="public-section" id="features">
        <div className="public-section__head">
          <h2>What the platform does</h2>
          <p>Everything is served from one Worker: the API, the candidate app and the teacher and admin consoles.</p>
        </div>
        <div className="grid grid--3">
          <Feature icon="⏱" title="Server-authoritative timing">
            Deadlines are recomputed on the server on every request. Refreshing the page, changing the system clock or
            reconnecting never grants extra time.
          </Feature>
          <Feature icon="🔒" title="Answer keys stay server-side">
            Objective sections are marked in the Worker against protected keys. Correct answers reach the browser only
            when a result is released.
          </Feature>
          <Feature icon="🧾" title="Versioned, immutable content">
            Publishing freezes a version. Later edits create a new version, so an attempt never changes after the fact.
          </Feature>
          <Feature icon="📥" title="Import with human review">
            Paste structured reading JSON or upload a document; the platform extracts structure, validates it and stops
            at review. Nothing is published automatically and no answer key is invented.
          </Feature>
          <Feature icon="🧮" title="Estimated bands, clearly labelled">
            Reading and Listening estimates use your own versioned conversion profile, and the interface always labels
            them as estimates. Writing is marked by a person.
          </Feature>
          <Feature icon="♿" title="Accessible by default">
            Keyboard navigation, visible focus, semantic labels, colour never carrying meaning alone, and reduced-motion
            support throughout.
          </Feature>
        </div>
      </section>

      <footer className="public-footer">
        <div className="public-footer__inner">
          <div>
            <div className="footer-brand" aria-label="Ai eo">
              <span className="brand-logo">
                <BrandLogo height={30} />
              </span>
            </div>
            <p>Independent English practice for schools and teachers, running on Cloudflare Workers and D1.</p>
          </div>
          <div>
            <h3>Product</h3>
            <p>
              <Link to="/register">Create an account</Link>
            </p>
            <p>
              <Link to="/login">Sign in</Link>
            </p>
          </div>
          <div>
            <h3>Integrity</h3>
            <p>
              Integrity monitoring records observable browser events only. It cannot see other applications, and it never
              reports a conclusion about a candidate.
            </p>
          </div>
        </div>
        <p className="public-footer__notice">
          Not affiliated with, endorsed by or connected to IELTS, the British Council, IDP or Cambridge. Ai eo
          does not reproduce their materials, logos or branding, and no practice band here is an official result.
          Content remains the responsibility of the institution that imports or writes it.
        </p>
      </footer>
    </div>
  );
}

function SkillCard({
  skill,
  name,
  detail,
  meta,
}: {
  skill: 'reading' | 'listening' | 'writing' | 'mock';
  name: string;
  detail: string;
  meta: string;
}) {
  return (
    <article className={`feature skill-card skill-${skill}`}>
      <span className="skill-chip">Skill</span>
      <h3 style={{ marginTop: 10 }}>{name}</h3>
      <p className="skill-card__meta">{meta}</p>
      <p className="muted small" style={{ marginBottom: 0 }}>
        {detail}
      </p>
    </article>
  );
}

function Feature({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <article className="feature">
      {icon ? (
        <div className="feature__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3>{title}</h3>
      <p className="muted small" style={{ marginBottom: 0 }}>
        {children}
      </p>
    </article>
  );
}

/**
 * Shared split-screen frame for the public auth pages: a deep brand rail that
 * says what the account is for, next to a quiet form panel. One source of truth
 * so sign in, sign up and joining a classroom all look the same.
 */
function AuthScreen({
  eyebrow,
  title,
  lede,
  points,
  formTitle,
  formIntro,
  footer,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  points: Array<{ title: string; detail: string }>;
  formTitle: string;
  formIntro?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="auth">
      <aside className="auth__panel">
        <span className="auth__eyebrow">{eyebrow}</span>
        <div>
          <h2 className="auth__title">{title}</h2>
          <p className="auth__lede">{lede}</p>
        </div>
        <ul className="auth__points">
          {points.map((point) => (
            <li key={point.title}>
              <span className="auth__tick" aria-hidden="true">
                ✓
              </span>
              <span>
                <strong>{point.title}</strong>
                <span>{point.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="auth__fineprint">
          Ai eo is an independent practice platform. It is not affiliated with, endorsed by or connected to IELTS,
          the British Council, IDP or Cambridge, and no band shown here is an official result.
        </p>
      </aside>
      <section className="auth__form">
        <h1>{formTitle}</h1>
        {formIntro ? <p className="auth__form-intro">{formIntro}</p> : null}
        {children}
        {footer}
      </section>
    </div>
  );
}

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await login(email, password);
      const target = new URLSearchParams(location.search).get('next');
      navigate(target ?? (next.role === 'ADMIN' ? '/admin' : next.role === 'TEACHER' ? '/teacher' : '/dashboard'), {
        replace: true,
      });
    } catch (loginError) {
      setError(describeError(loginError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      eyebrow="Welcome back"
      title="Pick up the practice where you left it."
      lede="Your attempts, estimated bands and class assignments are all behind this sign in."
      points={[
        { title: 'Server-marked results', detail: 'Objective sections are marked in the Worker against protected answer keys.' },
        { title: 'Timing you cannot trick', detail: 'Deadlines are recomputed on the server, so refreshing never buys extra minutes.' },
        { title: 'Progress you can read', detail: 'Band estimates per skill, task-type accuracy and a full attempt history.' },
      ]}
      formTitle="Sign in"
      formIntro="Use the account your institution gave you, or the one you created."
      footer={
        <p className="auth__alt">
          No account yet? <Link to="/register">Create a student account</Link>.
        </p>
      }
    >
      <form onSubmit={submit}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div style={{ height: 12 }} />
        <Field label="Email" required>
          {(id) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="email"
              required
              placeholder="you@school.edu"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field label="Password" required>
          {(id) => (
            <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="current-password" required />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthScreen>
  );
}

/**
 * Live password-policy feedback. The rules mirror `checkPasswordPolicy` in
 * `src/worker/services/auth-service.ts` exactly, so what the candidate sees
 * before submitting is what the server will accept.
 */
const POLICY_RULES: Array<{ id: string; label: string; test: (password: string, email: string) => boolean }> = [
  { id: 'length', label: 'At least 10 characters', test: (password) => password.length >= 10 },
  {
    id: 'case',
    label: 'Upper-case, lower-case and a number',
    test: (password) => /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password),
  },
  {
    id: 'email',
    label: 'Does not contain your email address',
    test: (password, email) => {
      const local = email.split('@')[0]?.toLowerCase() ?? '';
      if (local.length < 4) return true;
      return !password.toLowerCase().includes(local);
    },
  },
];

function PasswordPolicy({ password, email }: { password: string; email: string }) {
  const results = POLICY_RULES.map((rule) => ({ ...rule, ok: rule.test(password, email) }));
  const satisfied = results.filter((result) => result.ok).length;
  const percent = password.length === 0 ? 0 : Math.round((satisfied / results.length) * 100);
  const strengthColor = satisfied === results.length ? 'var(--success)' : satisfied >= 2 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div className="policy" aria-live="polite">
      <div className="policy__meter" role="presentation">
        <div className="policy__meter-fill" style={{ width: `${percent}%`, background: strengthColor }} />
      </div>
      {results.map((result) => (
        <div key={result.id} className={`policy__row${result.ok && password ? ' policy__row--ok' : ''}`}>
          <span className="policy__dot" aria-hidden="true">
            {result.ok && password ? '✓' : ''}
          </span>
          <span>{result.label}</span>
        </div>
      ))}
    </div>
  );
}

export function RegisterPage() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '', displayName: '', bootstrapAdmin: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(true);

  useEffect(() => {
    void api
      .get<{ adminConfigured: boolean; registrationEnabled?: boolean }>('/api/auth/status')
      .then((status) => {
        setNeedsBootstrap(!status.adminConfigured);
        setRegistrationOpen(status.registrationEnabled !== false);
      })
      .catch(() => setNeedsBootstrap(false));
  }, []);

  if (user) return <Navigate to="/dashboard" replace />;

  if (!registrationOpen && !needsBootstrap) {
    return (
      <AuthScreen
        eyebrow="Sign-up closed"
        title="An administrator manages accounts on this platform."
        lede="Self-service registration has been switched off, so accounts are created for you."
        points={[
          { title: 'Ask your teacher', detail: 'They can add you to a classroom and issue your sign-in details.' },
          { title: 'Nothing is lost', detail: 'Once the account exists, every practice attempt and result is kept.' },
        ]}
        formTitle="Registration is closed"
        formIntro="Ask your teacher or administrator to create your account, then sign in with the details they give you."
      >
        <Notice tone="info">
          Self-service registration is disabled on this platform. An administrator has to create your account.
        </Notice>
        <div style={{ marginTop: 16 }}>
          <Link className="btn btn--primary btn--lg btn--block" to="/login">
            Go to sign in
          </Link>
        </div>
      </AuthScreen>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form);
      navigate(params.get('next') ?? '/dashboard', { replace: true });
    } catch (registerError) {
      setError(describeError(registerError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      eyebrow="Free student account"
      title="Practise Reading, Listening and Writing under real exam conditions."
      lede="No credit card and no trial timer. Create an account and start a full mock whenever you are ready."
      points={[
        { title: 'Four skills, one exam shell', detail: 'Passage on the left, questions on the right, a timer the server controls.' },
        { title: 'Honest integrity monitoring', detail: 'Observable browser events only — never a conclusion about you.' },
        { title: 'Estimated bands, clearly labelled', detail: 'A practice signal from your institution’s own conversion profile.' },
      ]}
      formTitle="Create your account"
      formIntro="Public sign-up creates a student account. Teachers and administrators are added by an administrator."
      footer={
        <p className="auth__alt">
          Already registered? <Link to="/login">Sign in instead</Link>.
        </p>
      }
    >
      <form onSubmit={submit}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div style={{ height: 12 }} />
        <Field label="Full name" required>
          {(id) => (
            <TextInput
              id={id}
              required
              placeholder="Nguyen Van A"
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            />
          )}
        </Field>
        <Field label="Email" required>
          {(id) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="email"
              required
              placeholder="you@school.edu"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          )}
        </Field>
        <Field label="Password" required hint="Stored only as a salted PBKDF2 hash — never as text.">
          {(id) => (
            <PasswordInput
              id={id}
              value={form.password}
              onChange={(value) => setForm({ ...form, password: value })}
              autoComplete="new-password"
              required
            />
          )}
        </Field>
        <PasswordPolicy password={form.password} email={form.email} />

        {needsBootstrap ? (
          <div className="auth__bootstrap">
            <Notice tone="info" title="First administrator">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.bootstrapAdmin}
                  onChange={(event) => setForm({ ...form, bootstrapAdmin: event.target.checked })}
                />
                <span>
                  Create the first administrator account for this platform. This option disappears as soon as an
                  administrator exists.
                </span>
              </label>
            </Notice>
          </div>
        ) : null}

        <div style={{ height: 16 }} />
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Create account
        </Button>
      </form>
    </AuthScreen>
  );
}

export function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = params.get('token');

  const join = async (payload: { token?: string; code?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ classroomName: string }>('/api/classrooms/join', payload);
      setMessage(`You have joined ${result.classroomName}.`);
      setTimeout(() => navigate('/dashboard'), 1200);
    } catch (joinError) {
      setError(describeError(joinError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      eyebrow="Classroom"
      title="Join your class and get the assigned tests."
      lede="Use the invitation link from your teacher, or type the class code they shared with you."
      points={[
        { title: 'Assigned work in one place', detail: 'Deadlines, attempt limits and released results per assignment.' },
        { title: 'Classes stay isolated', detail: 'A teacher can only ever see their own classrooms and students.' },
      ]}
      formTitle="Join a classroom"
      formIntro="Enter the class code from your teacher, or accept the invitation link you were sent."
    >
      {!user ? (
        <Notice tone="info" title="Sign in first">
          <Link to={`/login?next=${encodeURIComponent(`/join${token ? `?token=${token}` : ''}`)}`}>Sign in</Link> or{' '}
          <Link to={`/register?next=${encodeURIComponent(`/join${token ? `?token=${token}` : ''}`)}`}>create an account</Link>{' '}
          to accept this invitation.
        </Notice>
      ) : (
        <>
          {message ? <Notice tone="success">{message}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {token ? (
            <>
              <p className="small">
                An invitation link was detected. Accepting it enrols you in the classroom that issued it.
              </p>
              <Button variant="primary" size="lg" block loading={busy} onClick={() => void join({ token })}>
                Accept invitation
              </Button>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void join({ code });
              }}
            >
              <Field label="Class code" required>
                {(id) => (
                  <TextInput
                    id={id}
                    required
                    placeholder="ABC123"
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                  />
                )}
              </Field>
              <Button type="submit" variant="primary" size="lg" block loading={busy}>
                Join classroom
              </Button>
            </form>
          )}
        </>
      )}
    </AuthScreen>
  );
}

export function NotFoundPage() {
  return (
    <div className="empty" style={{ padding: 80 }}>
      <div className="empty__title">Page not found</div>
      <p className="muted">The page you requested does not exist.</p>
      <Link className="btn" to="/">
        Back to the start
      </Link>
    </div>
  );
}
