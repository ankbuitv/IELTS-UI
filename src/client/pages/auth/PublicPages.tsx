import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { BrandLogo, BrandMark } from '../../components/BrandLogo';
import { Icon, type IconName } from '../../components/Icon';
import { Button, Field, Notice, PasswordInput, TextInput } from '../../components/ui';
import { api, describeError } from '../../lib/api';

/* ------------------------------------------------------------------ landing */
type SkillKey = 'listening' | 'reading' | 'writing' | 'speaking';

const SKILLS: Array<{
  skill: SkillKey;
  icon: IconName;
  name: string;
  meta: string;
  detail: string;
  marked: string;
  judged: boolean;
}> = [
  {
    skill: 'listening',
    icon: 'headphones',
    name: 'Listening',
    meta: '4 sections · 40 questions · about 30 min',
    detail: 'An audio panel with play limits, section information, and note, table and sentence completion.',
    marked: 'Marked instantly against the key',
    judged: false,
  },
  {
    skill: 'reading',
    icon: 'book',
    name: 'Reading',
    meta: '3 passages · 40 questions · 60 min',
    detail: 'True / False / Not Given, matching headings and information, completion and short answers.',
    marked: 'Marked instantly against the key',
    judged: false,
  },
  {
    skill: 'writing',
    icon: 'pen',
    name: 'Writing',
    meta: 'Task 1 + Task 2 · 60 min',
    detail: 'An autosaved editor with a live word count. Corrections, four criteria and a band in seconds.',
    marked: 'Marked by two AI judges',
    judged: true,
  },
  {
    skill: 'speaking',
    icon: 'mic',
    name: 'Speaking',
    meta: 'Parts 1, 2 and 3 · 11–14 min',
    detail: 'Record each part, read your transcript, and get feedback on fluency, vocabulary and grammar.',
    marked: 'Marked by two AI judges',
    judged: true,
  },
];

const STEPS: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: 'book',
    title: 'Choose a paper',
    text: 'Pick a full test or a single skill. Reading and Listening have 40 questions; Writing has Task 1 and Task 2.',
  },
  {
    icon: 'clock',
    title: 'Sit it under exam conditions',
    text: 'A server clock, a tab lock and autosave keep it honest, on an exam screen that looks like the real one.',
  },
  {
    icon: 'trendingUp',
    title: 'See your band and what to fix',
    text: 'Instant marks for Reading and Listening, two AI judges for Writing and Speaking, then a short plan in Learn.',
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Is this the real IELTS test?',
    a: 'No. Ai eo is an independent practice platform in the style of the computer-delivered test. It is not affiliated with IELTS, IDP, the British Council or Cambridge, and every band you see is a practice estimate, never an official result.',
  },
  {
    q: 'How are Writing and Speaking marked?',
    a: 'Automatically, as soon as you submit. Two AI judges, Judge01 and Judge02, are briefed on the four public band criteria, score independently, and you see both opinions with a consensus band. If a teacher marks the same work, the teacher’s band always wins.',
  },
  {
    q: 'What happens if I switch tabs during a test?',
    a: 'It counts as a strike and you are stopped when you come back. At three strikes the attempt is submitted with the answers you had already given. A browser cannot block other apps, so Ai eo records the leave rather than pretending to prevent it.',
  },
  {
    q: 'Will I lose my work if my connection drops?',
    a: 'No. Answers autosave to the server as you go, and an essay that has not reached the server yet is also kept on your device until it does.',
  },
  {
    q: 'Does it work on a phone?',
    a: 'Yes. Every page is built for phones, tablets and computers. For a full paper a larger screen is more comfortable, and Speaking asks for microphone permission the first time.',
  },
];

/** The exam screen, as a picture: top bar with the timer, passage on the left, questions on the right. */
function MockExam() {
  const options = ['True', 'False', 'Not given'];
  return (
    <div className="mock mock--exam">
      <div className="mock__bar">
        <span className="mock__bar-title">
          <i className="mock__dot" /> Reading · Passage 2
        </span>
        <span className="mock__timer">54:12</span>
      </div>
      <div className="mock__split">
        <div className="mock__passage">
          <b>The return of the night train</b>
          <p>
            After 1990 the network shrank as budget airlines cut fares, yet the last decade has seen a quiet reversal.
            Several operators now run sleeper services between cities that had no direct link.
          </p>
          <p>
            Passengers cite two reasons: the cost of a hotel room saved, and a journey that does not feel like lost time.
          </p>
        </div>
        <div className="mock__questions">
          <b>Questions 14 to 16</b>
          <span className="mock__prompt">Do the statements agree with the passage?</span>
          {[
            ['14', 'Airlines caused the decline.', 0],
            ['15', 'Sleepers now reach new cities.', 0],
            ['16', 'Fares fell after 2010.', 2],
          ].map(([n, text, pick]) => (
            <div key={n as string} className="mock__q">
              <span className="mock__q-text">
                <em>{n}</em> {text}
              </span>
              <span className="mock__opts">
                {options.map((option, index) => (
                  <span key={option} className={index === pick ? 'is-picked' : undefined}>
                    {option}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MockBand() {
  const rows: Array<[string, string, number, SkillKey]> = [
    ['L', '7.5', 83, 'listening'],
    ['R', '7.0', 78, 'reading'],
    ['W', '6.5', 72, 'writing'],
    ['S', '6.5', 72, 'speaking'],
  ];
  return (
    <div className="mock mock--band">
      <span className="mock__label">Estimated band</span>
      <span className="mock__big">7.0</span>
      <ul className="mock__skills">
        {rows.map(([letter, value, width, skill]) => (
          <li key={letter} className={`skill-${skill}`}>
            <span>{letter}</span>
            <span className="mock__meter">
              <i style={{ width: `${width}%` }} />
            </span>
            <b>{value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MockJudges() {
  return (
    <div className="mock mock--judges">
      <span className="mock__label">Writing Task 2 · AI marking</span>
      <div className="mock__judge-row">
        <span>
          <small>Judge01</small>
          <b>6.5</b>
        </span>
        <span>
          <small>Judge02</small>
          <b>7.0</b>
        </span>
        <span className="is-final">
          <small>Consensus</small>
          <b>7.0</b>
        </span>
      </div>
      <span className="mock__judge-note">
        <Icon name="check" size={12} strokeWidth={3} /> Corrections and a Vietnamese summary included
      </span>
    </div>
  );
}

function HeroStage() {
  return (
    <div className="stage" aria-hidden="true">
      <span className="stage__bars">
        <i />
        <i />
        <i />
      </span>
      <span className="stage__dot" />
      <span className="stage__chip">
        <Icon name="flame" size={15} filled />
        12 day streak
      </span>
      <MockExam />
      <MockJudges />
      <MockBand />
    </div>
  );
}

function PathPreview() {
  const nodes: Array<{ label: string; state: 'done' | 'current' | 'locked'; offset: number; icon: IconName }> = [
    { label: 'Everyday words', state: 'done', offset: 0, icon: 'check' },
    { label: 'Linking ideas', state: 'done', offset: 1, icon: 'check' },
    { label: 'Describing graphs', state: 'current', offset: 2, icon: 'play' },
    { label: 'Opinion phrases', state: 'locked', offset: 1, icon: 'lock' },
    { label: 'Academic verbs', state: 'locked', offset: 0, icon: 'lock' },
  ];
  return (
    <div className="phone" aria-hidden="true">
      <div className="phone__stats">
        <span className="phone__stat phone__stat--fire">
          <Icon name="flame" size={16} filled /> 5
        </span>
        <span className="phone__stat phone__stat--xp">
          <Icon name="bolt" size={16} filled /> 120 XP
        </span>
        <span className="phone__stat phone__stat--heart">
          <Icon name="heart" size={16} filled /> 5
        </span>
      </div>
      <div className="phone__unit">
        <span>Unit 2 · Lesson 3 of 4</span>
        <strong>Describing data</strong>
      </div>
      <ol className="phone__path">
        {nodes.map((node) => (
          <li key={node.label} className={`phone__node phone__node--${node.state}`} style={{ '--shift': node.offset } as React.CSSProperties}>
            {node.state === 'current' ? <span className="phone__start">Start</span> : null}
            <span className="phone__disc">
              <Icon name={node.icon} size={node.state === 'current' ? 24 : 22} strokeWidth={node.state === 'done' ? 3 : 2.2} filled={node.state === 'current'} />
            </span>
            <span className="phone__label">{node.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function JudgeReport() {
  const criteria: Array<[string, number, string, string]> = [
    ['Task Response', 72, '7.0', '6.5'],
    ['Coherence and Cohesion', 66, '6.5', '6.5'],
    ['Lexical Resource', 72, '7.0', '7.0'],
    ['Grammatical Range', 60, '6.0', '6.5'],
  ];
  return (
    <div className="verdict" aria-hidden="true">
      <div className="verdict__head">
        <span>
          <Icon name="pen" size={15} /> Writing Task 2
        </span>
        <span className="verdict__done">
          <Icon name="check" size={12} strokeWidth={3} /> Marked in 14 s
        </span>
      </div>
      <div className="verdict__judges">
        <div>
          <small>Judge01</small>
          <b>6.5</b>
        </div>
        <div>
          <small>Judge02</small>
          <b>7.0</b>
        </div>
        <div className="is-final">
          <small>Consensus</small>
          <b>7.0</b>
        </div>
      </div>
      <ul className="verdict__criteria">
        <li className="verdict__legend" aria-hidden="true">
          <span>Criterion</span>
          <span />
          <b>Judge01 · Judge02</b>
        </li>
        {criteria.map(([name, width, a, b]) => (
          <li key={name}>
            <span>{name}</span>
            <span className="verdict__meter">
              <i style={{ width: `${width}%` }} />
            </span>
            <b>
              {a} · {b}
            </b>
          </li>
        ))}
      </ul>
      <div className="verdict__fix">
        <small>Correction</small>
        <p>
          The number of visitors <del>have been increase</del> <ins>has increased</ins> sharply since 2015.
        </p>
      </div>
      <p className="verdict__vi">
        <b>Tóm tắt:</b> Bố cục rõ ràng, lập luận mạch lạc. Cần luyện thêm câu phức và chia thì cho chính xác.
      </p>
    </div>
  );
}

const TRUST: Array<{ icon: IconName; text: string }> = [
  { icon: 'check', text: 'Reading and Listening marked instantly' },
  { icon: 'sparkle', text: 'Writing and Speaking marked by two AI judges' },
  { icon: 'lock', text: 'Server clock and tab lock' },
];

const FACTS: Array<{ value: string; label: string; detail: string }> = [
  { value: '4', label: 'papers', detail: 'Listening, Reading, Writing and Speaking' },
  { value: '2', label: 'AI judges', detail: 'Independent scores, one consensus band' },
  { value: '40', label: 'questions', detail: 'Full-length Reading and Listening papers' },
  { value: '3', label: 'strikes', detail: 'Tab lock, then the attempt is submitted' },
];

export function LandingPage() {
  const { user } = useAuth();
  const { hash } = useLocation();

  // Footer and header links point at sections ("/#faq"); scroll there once the page is on screen.
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }, [hash]);

  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="lp">
      <section className="lp-hero">
        <div className="lp-wrap lp-hero__grid">
          <div className="lp-hero__copy">
            <p className="lp-pill">
              <i /> Luyện IELTS như thi thật
            </p>
            <h1>
              Practise IELTS the way the test <span>actually feels.</span>
            </h1>
            <p className="lp-hero__lede">
              Timed Reading, Listening, Writing and Speaking on a computer-delivered exam screen. Writing and Speaking
              are marked automatically by two AI judges, and a daily learning path builds the vocabulary behind your band.
            </p>
            <div className="lp-hero__actions">
              <Link className="btn btn--primary btn--lg" to="/register">
                Create an account
                <Icon name="arrowRight" size={18} strokeWidth={2.4} />
              </Link>
              <Link className="btn btn--lg" to="/login">
                Sign in
              </Link>
            </div>
            <ul className="lp-trust">
              {TRUST.map((item) => (
                <li key={item.text}>
                  <span>
                    <Icon name={item.icon} size={13} strokeWidth={2.6} />
                  </span>
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
          <HeroStage />
        </div>
      </section>

      <div className="lp-wrap">
        <dl className="lp-facts">
          {FACTS.map((fact) => (
            <div key={fact.label}>
              <dt>
                <b>{fact.value}</b> {fact.label}
              </dt>
              <dd>{fact.detail}</dd>
            </div>
          ))}
        </dl>
      </div>

      <section className="lp-section" id="skills">
        <div className="lp-wrap">
          <header className="lp-head">
            <p className="lp-eyebrow">The four papers</p>
            <h2>One exam screen for every paper</h2>
            <p>Passage on the left, questions on the right, a timer you can trust, and answers saved as you go.</p>
          </header>
          <div className="lp-skills">
            {SKILLS.map((item) => (
              <article key={item.skill} className={`lp-skill skill-${item.skill}`}>
                <span className="lp-skill__icon">
                  <Icon name={item.icon} size={24} strokeWidth={2} />
                </span>
                <h3>{item.name}</h3>
                <p className="lp-skill__meta">{item.meta}</p>
                <p className="lp-skill__text">{item.detail}</p>
                <p className="lp-skill__marked">
                  <Icon name={item.judged ? 'sparkle' : 'check'} size={14} strokeWidth={2.4} />
                  {item.marked}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section lp-section--white" id="how">
        <div className="lp-wrap">
          <header className="lp-head lp-head--center">
            <p className="lp-eyebrow">How it works</p>
            <h2>From first question to a plan, in three steps</h2>
          </header>
          <ol className="lp-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="lp-steps__no">{index + 1}</span>
                <span className="lp-steps__icon">
                  <Icon name={step.icon} size={22} />
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-section" id="learn">
        <div className="lp-wrap lp-split">
          <div className="lp-split__copy">
            <p className="lp-eyebrow">Learn</p>
            <h2>A daily path, built around your level</h2>
            <p>
              Short lessons with choose, fill-in, type, order and match exercises. Earn XP, keep your streak and unlock
              the next lesson. Each day the AI adds words pitched at your current band, and a spaced review brings them
              back before you forget.
            </p>
            <ul className="lp-ticks">
              <li>Lessons start at the right level for you</li>
              <li>New vocabulary every day, saved to your notebook</li>
              <li>A built-in dictionary with Vietnamese meanings and examples</li>
            </ul>
          </div>
          <PathPreview />
        </div>
      </section>

      <section className="lp-section lp-section--white" id="marking">
        <div className="lp-wrap lp-split lp-split--reverse">
          <JudgeReport />
          <div className="lp-split__copy">
            <p className="lp-eyebrow">AI marking</p>
            <h2>Two judges, one consensus band</h2>
            <p>
              Submit a Writing or Speaking task and it is marked at once. Judge01 and Judge02 each score the four public
              criteria independently after the same rubric briefing. You see both opinions, the consensus, corrections and
              a short summary in Vietnamese.
            </p>
            <ul className="lp-ticks">
              <li>The rubric brief is attached to every single request</li>
              <li>If the judges disagree by a band or more, it is flagged</li>
              <li>A teacher’s band always overrides the AI</li>
            </ul>
            <p className="lp-note">
              AI marking is an estimate for study. It is consistent and fast, but it is not an examiner and it can be
              wrong. Use it to find what to fix next.
            </p>
          </div>
        </div>
      </section>

      <section className="lp-exam" id="exam">
        <div className="lp-wrap">
          <header className="lp-head lp-head--center">
            <p className="lp-eyebrow">Exam conditions</p>
            <h2>Practise under pressure, not in a comfort zone</h2>
          </header>
          <div className="lp-trio">
            <article>
              <span><Icon name="clock" size={22} /></span>
              <h3>Server-side timer</h3>
              <p>Time is kept by the server, so refreshing the page or changing your clock never buys extra minutes.</p>
            </article>
            <article>
              <span><Icon name="lock" size={22} /></span>
              <h3>Tab lock</h3>
              <p>
                Leaving the exam tab is counted and you are stopped when you return. At three strikes the attempt is
                submitted. A browser cannot block other apps, so Ai eo records it instead.
              </p>
            </article>
            <article>
              <span><Icon name="checkCircle" size={22} /></span>
              <h3>Nothing is lost</h3>
              <p>Answers and essays autosave, and an unsent essay is also kept on your device until it reaches the server.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="lp-section" id="teachers">
        <div className="lp-wrap">
          <header className="lp-head lp-head--center">
            <p className="lp-eyebrow">For teachers</p>
            <h2>Classrooms without the spreadsheet</h2>
          </header>
          <div className="lp-trio lp-trio--light">
            <article>
              <span><Icon name="users" size={22} /></span>
              <h3>Classrooms and invitations</h3>
              <p>Create a class, share a code and keep every class isolated. Teachers only ever see their own students.</p>
            </article>
            <article>
              <span><Icon name="calendar" size={22} /></span>
              <h3>Assignments with rules</h3>
              <p>Deadlines, attempt limits, timing and result-release policy per assignment, plus per-class tab-lock settings.</p>
            </article>
            <article>
              <span><Icon name="trendingUp" size={22} /></span>
              <h3>Reports that stay honest</h3>
              <p>Band distributions, task-type accuracy and observable integrity events, never a verdict about a candidate.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="lp-section lp-section--white" id="faq">
        <div className="lp-wrap lp-faq">
          <header className="lp-head">
            <p className="lp-eyebrow">Questions</p>
            <h2>Before you start</h2>
            <p>The honest answers, including what Ai eo cannot do.</p>
          </header>
          <div className="lp-faq__list">
            {FAQ.map((item, index) => (
              <details key={item.q} open={index === 0}>
                <summary>
                  {item.q}
                  <Icon name="chevronDown" size={18} strokeWidth={2.2} />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-cta">
        <div className="lp-wrap lp-cta__inner">
          <div>
            <h2>Ready for your first paper?</h2>
            <p>Creating an account takes under a minute. Your first test is one tap away.</p>
            <div className="lp-cta__actions">
              <Link className="btn btn--lg lp-cta__primary" to="/register">
                Create an account
                <Icon name="arrowRight" size={18} strokeWidth={2.4} />
              </Link>
              <Link className="btn btn--lg lp-cta__ghost" to="/login">
                Sign in
              </Link>
            </div>
          </div>
          <span className="lp-cta__mark" aria-hidden="true">
            <BrandMark theme="brand" size={168} />
          </span>
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
        <span className="auth__bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <Link to="/" className="auth__brand" aria-label="Ai eo home">
          <BrandLogo theme="brand" height={34} />
        </Link>
        <div className="auth__pitch">
          <span className="auth__eyebrow">{eyebrow}</span>
          <h2 className="auth__title">{title}</h2>
          <p className="auth__lede">{lede}</p>
        </div>
        <ul className="auth__points">
          {points.map((point) => (
            <li key={point.title}>
              <span className="auth__tick" aria-hidden="true">
                <Icon name="check" size={12} strokeWidth={3.2} />
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
      <span className="notfound__mark">
        <BrandMark size={56} />
      </span>
      <p className="notfound__code">404</p>
      <h1>Page not found</h1>
      <p className="muted">The page you requested does not exist or has moved.</p>
      <Link className="btn btn--primary btn--lg" to="/">
        Back to the start
      </Link>
    </div>
  );
}
