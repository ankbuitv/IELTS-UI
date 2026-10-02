import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Icon, type IconName } from '../../components/Icon';
import { Button, Field, Notice, PasswordInput, TextInput } from '../../components/ui';
import { api, describeError } from '../../lib/api';

const SKILLS: Array<{
  skill: 'listening' | 'reading' | 'writing' | 'speaking';
  icon: IconName;
  name: string;
  meta: string;
  detail: string;
  marked: string;
}> = [
  {
    skill: 'listening',
    icon: 'headphones',
    name: 'Listening',
    meta: '4 sections · 40 questions · about 30 min',
    detail: 'Audio panel with play limits, section information and note, table and sentence completion.',
    marked: 'Marked instantly against the answer key',
  },
  {
    skill: 'reading',
    icon: 'book',
    name: 'Reading',
    meta: '3 passages · 40 questions · 60 min',
    detail: 'True / False / Not Given, matching headings and information, completion and short answers.',
    marked: 'Marked instantly against the answer key',
  },
  {
    skill: 'writing',
    icon: 'pen',
    name: 'Writing',
    meta: 'Task 1 + Task 2 · 60 min',
    detail: 'Autosaved editor with a live word count. Corrections, criteria and a band in seconds.',
    marked: 'Marked automatically by two AI judges',
  },
  {
    skill: 'speaking',
    icon: 'mic',
    name: 'Speaking',
    meta: 'Parts 1, 2 and 3 · 11–14 min',
    detail: 'Record each part, read your transcript and get feedback on fluency, vocabulary and grammar.',
    marked: 'Marked automatically by two AI judges',
  },
];

function SampleReport() {
  const rows: Array<[string, string, string]> = [
    ['Listening', '7.0', 'answer key'],
    ['Reading', '6.5', 'answer key'],
    ['Writing', '6.5', 'Judge01 6.5 · Judge02 6.5'],
    ['Speaking', '6.0', 'Judge01 6.0 · Judge02 6.0'],
  ];
  return (
    <figure className="report" aria-label="Sample practice report">
      <figcaption className="report__head">
        <span>Practice report</span>
        <span className="report__tag">Sample</span>
      </figcaption>
      <div className="report__body">
        <div className="report__overall">
          <span className="report__overall-label">Overall band</span>
          <span className="report__overall-value">6.5</span>
        </div>
        <table className="report__table">
          <tbody>
            {rows.map(([skill, band, basis]) => (
              <tr key={skill}>
                <th scope="row">{skill}</th>
                <td className="report__band">{band}</td>
                <td className="report__basis">{basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="report__note">Illustration only. Bands in Ai eo are practice estimates, never an official result.</p>
    </figure>
  );
}

function PathPreview() {
  const nodes: Array<{ label: string; state: 'done' | 'current' | 'locked'; offset: number }> = [
    { label: 'Everyday words', state: 'done', offset: 0 },
    { label: 'Linking ideas', state: 'done', offset: 1 },
    { label: 'Describing graphs', state: 'current', offset: 2 },
    { label: 'Opinion phrases', state: 'locked', offset: 1 },
    { label: 'Academic verbs', state: 'locked', offset: 0 },
  ];
  return (
    <div className="path-preview" aria-hidden="true">
      <div className="path-preview__chips">
        <span className="path-chip">
          <Icon name="zap" size={13} /> 5 day streak
        </span>
        <span className="path-chip">120 XP</span>
      </div>
      <ol className="path-preview__list">
        {nodes.map((node) => (
          <li key={node.label} style={{ marginLeft: node.offset * 34 }} className={`path-preview__node path-preview__node--${node.state}`}>
            <span className="path-preview__dot">
              <Icon name={node.state === 'done' ? 'check' : node.state === 'locked' ? 'lock' : 'play'} size={16} />
            </span>
            <span className="path-preview__label">{node.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function JudgePreview() {
  return (
    <div className="judge-preview" aria-hidden="true">
      <div className="judge-preview__judges">
        <div className="judge-preview__judge">
          <span className="judge-preview__name">Judge01</span>
          <span className="judge-preview__band">6.5</span>
        </div>
        <div className="judge-preview__judge">
          <span className="judge-preview__name">Judge02</span>
          <span className="judge-preview__band">6.0</span>
        </div>
        <div className="judge-preview__judge judge-preview__judge--final">
          <span className="judge-preview__name">Consensus</span>
          <span className="judge-preview__band">6.5</span>
        </div>
      </div>
      <ul className="judge-preview__criteria">
        <li>
          <span>Task Response</span>
          <span className="judge-preview__bar"><i style={{ width: '72%' }} /></span>
          <b>6.5</b>
        </li>
        <li>
          <span>Coherence and Cohesion</span>
          <span className="judge-preview__bar"><i style={{ width: '66%' }} /></span>
          <b>6.0</b>
        </li>
        <li>
          <span>Lexical Resource</span>
          <span className="judge-preview__bar"><i style={{ width: '72%' }} /></span>
          <b>6.5</b>
        </li>
        <li>
          <span>Grammatical Range</span>
          <span className="judge-preview__bar"><i style={{ width: '60%' }} /></span>
          <b>5.5</b>
        </li>
      </ul>
    </div>
  );
}

export function LandingPage() {
  const { user } = useAuth();
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero__inner">
          <div className="hero__copy">
            <p className="hero__kicker">Independent IELTS-style practice</p>
            <h1>Practise for IELTS the way the test actually feels.</h1>
            <p className="hero__lede">
              Timed Reading, Listening, Writing and Speaking on a computer-delivered exam screen. Writing and Speaking are
              marked automatically by two AI judges, and a daily learning path builds the vocabulary behind your band.
            </p>
            <div className="hero__actions">
              <Link className="btn btn--primary btn--lg" to="/register">
                Create a free account
              </Link>
              <Link className="btn btn--lg" to="/login">
                Sign in
              </Link>
            </div>
            <dl className="hero__facts">
              <div>
                <dt>4</dt>
                <dd>skills in the exam screen</dd>
              </div>
              <div>
                <dt>2</dt>
                <dd>AI judges, one consensus band</dd>
              </div>
              <div>
                <dt>3</dt>
                <dd>tab-switch strikes, then auto-submit</dd>
              </div>
            </dl>
          </div>
          <SampleReport />
        </div>
      </section>

      <section className="band" id="skills">
        <div className="band__inner">
          <header className="band__head">
            <p className="eyebrow">The four skills</p>
            <h2>One exam screen for every paper</h2>
            <p>Passage on the left, questions on the right, a timer you can trust and answers that are saved as you go.</p>
          </header>
          <div className="skill-grid">
            {SKILLS.map((item) => (
              <article key={item.skill} className={`skill-tile skill-${item.skill}`}>
                <span className="skill-tile__icon">
                  <Icon name={item.icon} size={20} />
                </span>
                <h3>{item.name}</h3>
                <p className="skill-tile__meta">{item.meta}</p>
                <p>{item.detail}</p>
                <p className="skill-tile__marked">{item.marked}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band band--muted" id="learn">
        <div className="band__inner split">
          <div>
            <p className="eyebrow">Learn</p>
            <h2>A daily path, built around your level</h2>
            <p>
              Short lessons with choose, fill-in, type, order and match exercises. Earn XP, keep your streak and unlock the
              next lesson. Each day the AI adds new words pitched at your current band, and a spaced-repetition review
              brings them back before you forget.
            </p>
            <ul className="tick-list">
              <li>Lessons start at the right level for you</li>
              <li>New vocabulary every day, saved to your notebook</li>
              <li>Built-in dictionary with Vietnamese meanings and examples</li>
            </ul>
          </div>
          <PathPreview />
        </div>
      </section>

      <section className="band" id="marking">
        <div className="band__inner split split--reverse">
          <JudgePreview />
          <div>
            <p className="eyebrow">AI marking</p>
            <h2>Two judges, one consensus band</h2>
            <p>
              Submit a Writing or Speaking task and it is marked at once. Judge01 and Judge02 each score the four public
              criteria independently after being briefed on the same rubric; you see both opinions, the consensus band,
              corrections and a short summary in Vietnamese.
            </p>
            <p className="muted small">
              AI marking is an estimate for study. It is consistent and fast, but it is not an examiner and it can be
              wrong, so use it to find what to fix next.
            </p>
          </div>
        </div>
      </section>

      <section className="band band--dark" id="exam">
        <div className="band__inner">
          <header className="band__head">
            <p className="eyebrow">Exam conditions</p>
            <h2>Practise under pressure, not in a comfort zone</h2>
          </header>
          <div className="trio">
            <article>
              <Icon name="clock" size={22} />
              <h3>Server-side timer</h3>
              <p>Time is kept by the server, so refreshing or changing your clock never buys extra minutes.</p>
            </article>
            <article>
              <Icon name="lock" size={22} />
              <h3>Tab lock</h3>
              <p>
                Leaving the exam tab is counted and you are stopped when you come back. At three strikes the attempt is
                submitted. A browser cannot block other apps, so Ai eo records it instead.
              </p>
            </article>
            <article>
              <Icon name="check" size={22} />
              <h3>Nothing is lost</h3>
              <p>Answers and essays autosave, and an unsent essay is also kept on your device until it reaches the server.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="band" id="teachers">
        <div className="band__inner">
          <header className="band__head">
            <p className="eyebrow">For teachers</p>
            <h2>Classrooms without the spreadsheet</h2>
          </header>
          <div className="trio trio--light">
            <article>
              <Icon name="users" size={22} />
              <h3>Classrooms and invitations</h3>
              <p>Create a class, share a code and keep every class isolated. Teachers only ever see their own students.</p>
            </article>
            <article>
              <Icon name="calendar" size={22} />
              <h3>Assignments with rules</h3>
              <p>Deadlines, attempt limits, timing and result-release policy per assignment, plus per-class tab-lock settings.</p>
            </article>
            <article>
              <Icon name="trendingUp" size={22} />
              <h3>Reports that stay honest</h3>
              <p>Band distributions, task-type accuracy and observable integrity events, never a verdict about a candidate.</p>
            </article>
          </div>
          <div className="cta-strip">
            <div>
              <strong>Ready for your first test?</strong>
              <span>It takes under a minute to create an account.</span>
            </div>
            <Link className="btn btn--primary btn--lg" to="/register">
              Create a free account
            </Link>
          </div>
        </div>
      </section>
    </div>
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
                <Icon name="check" size={12} strokeWidth={3} />
              </span>
              <span>
                <strong>{point.title}</strong>
                <span>{point.detail}</span>
              </span>
            </li>
          ))}
        </ul>
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
      lede="Your lessons, attempts, estimated bands and class assignments are all behind this sign in."
      points={[
        { title: 'Instant marking', detail: 'Reading and Listening against the key; Writing and Speaking by two AI judges.' },
        { title: 'Timing you cannot trick', detail: 'The server keeps the clock, so refreshing never buys extra minutes.' },
        { title: 'Progress you can read', detail: 'Band estimates per skill, your daily path and a full attempt history.' },
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
            {result.ok && password ? <Icon name="check" size={10} strokeWidth={3.5} /> : null}
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
      title="Practise all four skills under real exam conditions."
      lede="No credit card and no trial timer. Create an account and start whenever you are ready."
      points={[
        { title: 'Four skills, one exam screen', detail: 'Passage on the left, questions on the right, a timer the server controls.' },
        { title: 'AI marking in seconds', detail: 'Writing and Speaking get a band, corrections and a Vietnamese summary.' },
        { title: 'A daily learning path', detail: 'Short lessons, new words for your level and a built-in dictionary.' },
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
        <Field label="Password" required>
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
    <div className="notfound">
      <p className="notfound__code">404</p>
      <h1>Page not found</h1>
      <p className="muted">The page you requested does not exist.</p>
      <Link className="btn btn--primary" to="/">
        Back to the start
      </Link>
    </div>
  );
}
