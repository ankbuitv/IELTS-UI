import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, Field, Notice, TextInput } from '../../components/ui';
import { api, describeError } from '../../lib/api';

export function LandingPage() {
  const { user } = useAuth();
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="stack" style={{ gap: 0 }}>
      <section className="public-hero" style={{ margin: '-24px -20px 0', padding: '64px 24px 72px' }}>
        <div className="public-hero__inner stack">
          <span className="badge badge--accent" style={{ width: 'fit-content' }}>
            Independent practice platform
          </span>
          <h1>Computer-based exam practice, classroom management and full mock tests.</h1>
          <p>
            Meridian Test Studio gives teachers a complete workflow: original Reading, Listening and Writing practice;
            server-marked results; assigned deadlines; and integrity monitoring that is honest about what a browser can
            and cannot observe.
          </p>
          <div className="row">
            <Link className="btn btn--primary btn--lg" to="/register">
              Create a free student account
            </Link>
            <Link className="btn btn--lg" to="/login" style={{ background: 'transparent', color: '#eaf1f6', borderColor: 'rgba(255,255,255,0.35)' }}>
              Sign in
            </Link>
          </div>
          <p className="tiny" style={{ color: '#a9c0ce', maxWidth: 720 }}>
            Not affiliated with, endorsed by or connected to IELTS, the British Council, IDP or Cambridge. All practice
            material on this platform is original or imported by your institution under its own rights.
          </p>
        </div>
      </section>

      <section className="public-section grid grid--3">
        <Feature title="Exam shell that behaves like the real thing">
          Server-authoritative countdown, autosave, flag-for-review, unanswered warnings and full refresh/reconnect
          recovery. Refreshing the page or changing your system clock never adds time.
        </Feature>
        <Feature title="Reading, Listening and Writing">
          TRUE/FALSE/NOT GIVEN, YES/NO/NOT GIVEN, multiple choice, matching information, matching headings,
          sentence/summary/note completion and short answer, plus realistic Writing tasks with autosave and word counts.
        </Feature>
        <Feature title="Classrooms and assignments">
          Create a classroom, invite students securely, assign a published test with a deadline, attempt limit, timing
          policy and result-release policy, then review class analytics.
        </Feature>
        <Feature title="Server-side marking">
          Objective sections are marked in the Worker against protected answer keys. Correct answers never reach the
          browser before a result is released.
        </Feature>
        <Feature title="Versioned tests">
          Publishing freezes an immutable version. Later edits create a new version, so an attempt never changes after
          the fact.
        </Feature>
        <Feature title="AI-assisted import, human approved">
          Upload a PDF, DOCX or text source; the server extracts structure and proposes a draft. Nothing is published
          automatically and the model is never allowed to invent an answer key.
        </Feature>
      </section>
    </div>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="feature">
      <h3>{title}</h3>
      <p className="muted small" style={{ marginBottom: 0 }}>
        {children}
      </p>
    </article>
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
    <div style={{ maxWidth: 420, margin: '40px auto' }}>
      <Card title="Sign in" hint="Use the account your institution gave you.">
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
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Field label="Password" required>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" block loading={busy}>
            Sign in
          </Button>
        </form>
        <p className="small muted" style={{ marginTop: 14 }}>
          No account yet? <Link to="/register">Create a student account</Link>.
        </p>
      </Card>
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
      <div style={{ maxWidth: 460, margin: '40px auto' }}>
        <Card title="Registration is closed">
          <Notice tone="info">
            An administrator has switched off self-service registration on this platform. Ask your teacher or
            administrator to create your account for you, then sign in with the credentials they give you.
          </Notice>
          <div style={{ marginTop: 12 }}>
            <Link className="btn btn--block" to="/login">
              Go to sign in
            </Link>
          </div>
        </Card>
      </div>
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
    <div style={{ maxWidth: 460, margin: '40px auto' }}>
      <Card
        title="Create your account"
        hint="Public sign-up creates a student account. Teachers and administrators are added by an administrator."
      >
        <form onSubmit={submit}>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <div style={{ height: 12 }} />
          <Field label="Full name" required>
            {(id) => (
              <TextInput
                id={id}
                required
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
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            )}
          </Field>
          <Field
            label="Password"
            required
            hint="At least 10 characters with upper case, lower case and a number. Passwords are stored only as salted PBKDF2 hashes."
          >
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                required
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
            )}
          </Field>

          {needsBootstrap ? (
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
          ) : null}

          <div style={{ height: 14 }} />
          <Button type="submit" variant="primary" block loading={busy}>
            Create account
          </Button>
        </form>
      </Card>
    </div>
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
    <div style={{ maxWidth: 480, margin: '40px auto' }}>
      <Card title="Join a classroom" hint="Use the invitation link from your teacher, or enter the class code.">
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
                <Button variant="primary" loading={busy} onClick={() => void join({ token })}>
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
                    <TextInput id={id} required value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} />
                  )}
                </Field>
                <Button type="submit" variant="primary" loading={busy}>
                  Join classroom
                </Button>
              </form>
            )}
          </>
        )}
      </Card>
    </div>
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
