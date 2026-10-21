import { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, Notice, ProgressBar } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../context/AuthContext';

/**
 * Training hub for mentors and teachers — a separate, role-specific curriculum
 * with checklists. Progress is remembered per signed-in account in
 * localStorage, so it survives reloads without needing a server table.
 */
interface TrainingModule {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  audience: Array<'MENTOR' | 'TEACHER'>;
  steps: string[];
  tip: string;
}

const MODULES: TrainingModule[] = [
  {
    id: 'mentor-first-call',
    title: 'Run a great first 1:1 call',
    summary: 'From camera check to the first five minutes — how strong mentors open a session.',
    minutes: 10,
    audience: ['MENTOR'],
    steps: [
      'Test camera and microphone before the session window opens.',
      'Open the plan for the session in one tab; keep the call room in another.',
      'Greet by name and ask what the learner wants to walk away with today.',
      'Share your screen only when it helps; keep faces visible the rest of the time.',
      'Close with a two-line recap and one concrete action for the week.',
    ],
    tip: 'Sessions start on time. Join the room a minute early — presence is the first signal of professionalism.',
  },
  {
    id: 'mentor-feedback',
    title: 'Feedback that learners act on',
    summary: 'The comment sandwich is not enough. Structure feedback around evidence and one next step.',
    minutes: 12,
    audience: ['MENTOR'],
    steps: [
      'Quote the exact sentence or answer you are discussing — never paraphrase only.',
      'Name one thing that worked and why it worked.',
      'Name one thing to change, with a concrete rewrite or example.',
      'End with a single practice action the learner can do before the next session.',
    ],
    tip: 'Write feedback while you still remember the detail. Vague praise feels good and teaches nothing.',
  },
  {
    id: 'mentor-classes',
    title: 'Build a live class that fills up',
    summary: 'Capacity, scheduling and the group dynamic: how to run classes of 10 or 1,000.',
    minutes: 15,
    audience: ['MENTOR'],
    steps: [
      'Write a title that promises a specific outcome, not a subject.',
      'Set capacity honestly — the platform allows up to 5,000 seats.',
      'Use the class chat for announcements and questions before the session.',
      'Open the class room early and pin the agenda in chat.',
      'Record attendance and follow up with a summary message afterwards.',
    ],
    tip: 'Class chat is asynchronous gold — answer the quiet learners there who never unmute in the call.',
  },
  {
    id: 'teacher-classroom',
    title: 'Set up a classroom end to end',
    summary: 'Join codes, assignments, deadlines — the full classroom workflow in one pass.',
    minutes: 10,
    audience: ['TEACHER'],
    steps: [
      'Create the classroom and share the join code with your students.',
      'Publish at least one assignment with a realistic deadline.',
      'Post a welcome message in the course chat so the room is not empty.',
      'Check the class dashboard after the first deadline for stragglers.',
    ],
    tip: 'Students who join by code see everything instantly — no approval queue to babysit.',
  },
  {
    id: 'teacher-marking',
    title: 'Mark consistently across a cohort',
    summary: 'AI marking handles the first pass. Your job is judgement and consistency.',
    minutes: 14,
    audience: ['TEACHER'],
    steps: [
      'Start from the marking queue, not from individual students.',
      'Read the AI judgement before overriding — note why when you disagree.',
      'Use the same band descriptors for every script in the cohort.',
      'Release results together so no student sees answers early.',
    ],
    tip: 'When you override an AI band, the platform keeps your reason — future moderation starts there.',
  },
  {
    id: 'teacher-integrity',
    title: 'Exam integrity without the paranoia',
    summary: 'How the platform times attempts, locks submissions and logs integrity events.',
    minutes: 8,
    audience: ['TEACHER'],
    steps: [
      'Remember: the server owns the clock — refreshing never adds time.',
      'Review integrity events on an attempt before accusing anyone.',
      'Use practice mode for learning and exam mode for measurement.',
      'Talk to students about the policy before the first timed test.',
    ],
    tip: 'Most integrity flags are innocent — a dropped connection looks a lot like a tab switch.',
  },
];

const STORAGE_KEY = (userId: string) => `training-progress:${userId}`;

function loadProgress(userId: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY(userId)) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function TrainingPage() {
  const { user } = useAuth();
  const role = user?.role;
  const [progress, setProgress] = useState<Record<string, boolean>>(() => loadProgress(user?.id ?? ''));

  const modules = useMemo(
    () => MODULES.filter((module) => (role === 'ADMIN' ? true : module.audience.includes(role === 'MENTOR' ? 'MENTOR' : 'TEACHER'))),
    [role],
  );

  const toggle = (key: string) => {
    const next = { ...progress, [key]: !progress[key] };
    setProgress(next);
    if (user?.id) localStorage.setItem(STORAGE_KEY(user.id), JSON.stringify(next));
  };

  const moduleDone = (module: TrainingModule) => module.steps.every((_, index) => progress[`${module.id}:${index}`]);
  const doneCount = modules.filter(moduleDone).length;

  if (role !== 'MENTOR' && role !== 'TEACHER' && role !== 'ADMIN') {
    return (
      <div className="stack">
        <h1>Training</h1>
        <EmptyState title="For mentors and teachers" icon="bulb">
          <p>This area trains mentors and teachers. Learners get their own path under Learn.</p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>Training</h1>
      <p className="muted" style={{ maxWidth: 720 }}>
        {role === 'MENTOR'
          ? 'Your coaching track: how to run calls, give feedback that lands and build live classes.'
          : role === 'TEACHER'
            ? 'Your teaching track: classroom setup, consistent marking and exam integrity.'
            : 'Both tracks are shown to administrators.'}{' '}
        Tick each step as you complete it — progress is saved to your account on this device.
      </p>

      <Card>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <Badge tone={doneCount === modules.length ? 'success' : 'info'}>
            {doneCount}/{modules.length} modules complete
          </Badge>
          <span className="tiny muted">{role === 'MENTOR' ? 'Mentor track' : role === 'TEACHER' ? 'Teacher track' : 'All tracks'}</span>
        </div>
        <div style={{ marginTop: 10 }}>
          <p className="tiny muted" style={{ margin: '0 0 4px' }}>Overall progress</p>
          <ProgressBar value={doneCount} max={Math.max(modules.length, 1)} tone={doneCount === modules.length ? 'success' : 'violet'} />
        </div>
      </Card>

      {modules.map((module) => {
        const done = moduleDone(module);
        return (
          <Card
            key={module.id}
            title={module.title}
            hint={`${module.minutes} min · ${module.audience.join(' / ').toLowerCase()}`}
          >
            <p className="small muted" style={{ marginTop: 0 }}>{module.summary}</p>
            <div className="stack" style={{ gap: 8 }}>
              {module.steps.map((step, index) => {
                const key = `${module.id}:${index}`;
                const checked = Boolean(progress[key]);
                return (
                  <label
                    key={key}
                    className="row"
                    style={{
                      alignItems: 'flex-start',
                      gap: 10,
                      cursor: 'pointer',
                      opacity: checked ? 0.6 : 1,
                      textDecoration: checked ? 'line-through' : 'none',
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(key)} style={{ marginTop: 3 }} />
                    <span className="small">{step}</span>
                  </label>
                );
              })}
            </div>
            <div style={{ marginTop: 12 }}>
              <Notice tone="info" title="Tip">
                {module.tip}
              </Notice>
            </div>
            <div className="row gap-8" style={{ marginTop: 12 }}>
              {done ? (
                <span className="row tiny" style={{ color: 'var(--success)', gap: 6, alignItems: 'center' }}>
                  <Icon name="checkCircle" size={14} /> Module complete
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => module.steps.forEach((_, index) => {
                  if (!progress[`${module.id}:${index}`]) toggle(`${module.id}:${index}`);
                })}>
                  Mark all steps done
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
