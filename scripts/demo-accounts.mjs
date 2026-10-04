#!/usr/bin/env node
/**
 * Provisions the local *development* database with demo accounts and makes the
 * seeded sample content usable, so a fresh checkout (or a fresh sandbox, where
 * `.wrangler/` state does not survive) has a working application instead of an
 * empty catalogue:
 *
 *   1. ensures the bootstrap administrator exists,
 *   2. creates a TEACHER and a STUDENT account (idempotent),
 *   3. plays two Learn lessons as the demo student, on a profile that has never
 *      been used, so the path shows progress and the shop has coins in it,
 *   4. publishes the original sample tests that ship as DRAFT in seed/seed.sql.
 *
 * It talks to the running Worker over HTTP, so it uses exactly the same code
 * paths (hashing, validation, publishing) a human would. It never touches a
 * remote database: the base URL defaults to the local Worker.
 *
 *   npm run dev:api   # in one terminal
 *   npm run db:demo   # in another
 */
import process from 'node:process';

const BASE = (process.env.DEMO_BASE_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Passw0rd!23';

const ACCOUNTS = {
  admin: { email: 'admin@demo.test', displayName: 'Demo Admin', role: 'ADMIN' },
  teacher: { email: 'teacher@demo.test', displayName: 'Demo Teacher', role: 'TEACHER' },
  student: { email: 'student@demo.test', displayName: 'Demo Student', role: 'STUDENT' },
};

/** Minimal cookie-less client: the session token travels in a header. */
function createClient() {
  let sessionToken = null;
  let csrfToken = null;

  async function request(path, { method = 'GET', json } = {}) {
    const headers = { accept: 'application/json' };
    if (json !== undefined) headers['content-type'] = 'application/json';
    if (sessionToken) headers['x-session-token'] = sessionToken;
    if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });

    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
    if (body?.sessionToken) sessionToken = body.sessionToken;
    if (body?.csrfToken) csrfToken = body.csrfToken;
    return { status: response.status, body };
  }

  return {
    get: (path) => request(path),
    post: (path, json) => request(path, { method: 'POST', json }),
    patch: (path, json) => request(path, { method: 'PATCH', json }),
  };
}

const log = (...args) => console.log(...args);

/** The learner's own calendar day (`YYYY-MM-DD`), the same shape the app sends. */
function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function ensureAccount(client, account, { registerPath = '/api/auth/register', register = true } = {}) {
  if (register) {
    const payload = {
      email: account.email,
      password: PASSWORD,
      displayName: account.displayName,
      bootstrapAdmin: account.role === 'ADMIN',
    };

    const registered = await client.post(registerPath, payload);
    if (registered.status === 201) return { created: true, ...registered };
  }

  const loggedIn = await client.post('/api/auth/login', { email: account.email, password: PASSWORD });
  if (loggedIn.status === 200) return { created: false, ...loggedIn };

  return { created: false, status: loggedIn.status, body: loggedIn.body };
}

/**
 * Signs in as the demo teacher, creating the account through the admin API when
 * it is missing and *promoting* it when an older run registered it as a student.
 * Public sign-up only ever creates students, so a teacher must come from here.
 */
async function ensureTeacher(admin, account) {
  const client = createClient();
  const existing = await ensureAccount(client, account, { register: false });
  if (existing.body?.user?.role === account.role) {
    return { created: false, promoted: false, role: account.role };
  }

  if (existing.body?.user) {
    const promoted = await admin.patch(`/api/admin/users/${existing.body.user.id}`, { role: account.role });
    if (promoted.status === 200) return { created: false, promoted: true, role: account.role };
    return { created: false, promoted: false, error: promoted.body };
  }

  const created = await admin.post('/api/admin/users', {
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    password: PASSWORD,
  });
  if (created.status === 201) return { created: true, promoted: false, role: account.role };
  return { created: false, promoted: false, error: created.body };
}

/**
 * Two lessons finished, so the demo does not open on an empty wallet: the path
 * shows a first step taken, and the shop's cheapest items are affordable.
 *
 * Guarded by "the profile has never earned XP", which keeps the script
 * idempotent — a second run must not mint coins — and it reports what it did
 * rather than failing the whole provisioning run if the Learn API is unhappy.
 */
async function seedHeadStart(student) {
  const overview = await student.get(`/api/learn/overview?day=${today()}`);
  const profile = overview.body?.profile;
  if (!profile) return { skipped: `overview unavailable (${overview.status})` };
  if (profile.xp > 0) return { skipped: 'profile already in use', coins: profile.coins ?? 0 };

  const catalogue = await student.get('/api/learn/catalogue');
  const lessons = (catalogue.body?.selected?.units ?? []).flatMap((unit) => unit.lessons).slice(0, 2);
  if (lessons.length === 0) return { skipped: 'no lessons in the catalogue' };

  let coins = profile.coins ?? 0;
  let done = 0;
  for (const lesson of lessons) {
    const detail = await student.get(`/api/learn/lessons/${encodeURIComponent(lesson.id)}`);
    const words = detail.body?.lesson?.payload?.words?.length ?? 0;
    // A vocabulary lesson plans roughly two questions per word (choose, fill,
    // match, listen, type, order — the plan itself lives in the lesson engine
    // the browser runs). The Worker validates the shape of a result, not the
    // engine's private plan, and a demo profile has earned a perfect run.
    const total = Math.min(12, Math.max(4, words * 2));
    if (words === 0) continue;
    const result = await student.post('/api/learn/lessons/complete', {
      lessonId: lesson.id,
      correct: total,
      total,
      mistakes: [],
      day: today(),
    });
    if (result.status !== 200) return { skipped: `lesson ${lesson.id} could not be completed (${result.status})`, coins, done };
    coins += result.body?.coinsGained ?? 0;
    done += 1;
  }
  return { coins, done };
}

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`✗ No Worker answering on ${BASE}. Start it with \`npm run dev:api\` first.`);
    process.exit(1);
  }
  const healthBody = await health.json();
  if (!healthBody.database?.reachable) {
    console.error('✗ The database is not reachable:', JSON.stringify(healthBody.database));
    process.exit(1);
  }

  log(`▸ Seeding demo accounts on ${BASE}`);

  // 1. Administrator. The first account on an empty platform becomes ADMIN.
  const admin = createClient();
  const adminAccount = await ensureAccount(admin, ACCOUNTS.admin);
  if (!adminAccount.body?.user || adminAccount.body.user.role !== 'ADMIN') {
    console.error('✗ Could not obtain an administrator session. Details:', JSON.stringify(adminAccount.body));
    process.exit(1);
  }
  log(`  ✓ admin    ${ACCOUNTS.admin.email} (${adminAccount.created ? 'created' : 'existing'})`);

  // 2. Teacher, created (or promoted) by the administrator: public sign-up only
  //    makes students, and a database seeded by an earlier run may hold this
  //    address as a student.
  const teacherState = await ensureTeacher(admin, ACCOUNTS.teacher);
  if (teacherState.error) {
    log(`  ! teacher  ${ACCOUNTS.teacher.email} could not be prepared: ${JSON.stringify(teacherState.error)}`);
  } else if (teacherState.created) {
    log(`  ✓ teacher  ${ACCOUNTS.teacher.email} (created)`);
  } else if (teacherState.promoted) {
    log(`  ✓ teacher  ${ACCOUNTS.teacher.email} (role promoted to TEACHER)`);
  } else {
    log(`  · teacher  ${ACCOUNTS.teacher.email} present already`);
  }

  // 3. Student through the public registration path.
  const student = createClient();
  const studentAccount = await ensureAccount(student, ACCOUNTS.student);
  if (studentAccount.body?.user) {
    log(`  ${studentAccount.created ? '✓' : '·'} student  ${ACCOUNTS.student.email} (${studentAccount.created ? 'created' : 'existing'})`);
  } else {
    log(`  ! student  ${ACCOUNTS.student.email} could not be prepared: ${JSON.stringify(studentAccount.body)}`);
  }

  // 4. A head start for the demo learner, so /learn/shop has something to spend.
  if (studentAccount.body?.user) {
    const head = await seedHeadStart(student);
    if (head.skipped) {
      log(`  · student  head start skipped (${head.skipped})`);
    } else {
      log(`  ✓ student  head start: ${head.done} lessons, ${head.coins} coins, streak 1`);
    }
  }

  // 5. Publish the sample content so /practice is not empty.
  const tests = await admin.get('/api/admin/tests');
  const list = tests.body?.tests ?? [];
  let published = 0;
  for (const test of list) {
    const detail = await admin.get(`/api/admin/tests/${test.id}`);
    const draft = (detail.body?.versions ?? []).find((version) => version.status === 'DRAFT');
    if (!draft) continue;
    const result = await admin.post(`/api/admin/versions/${draft.id}/publish`, {
      changeNote: 'Published by scripts/demo-accounts.mjs',
      allowWarnings: true,
    });
    if (result.status === 200) {
      published += 1;
      log(`  ✓ published "${test.title}" (v${draft.version_number})`);
    } else {
      log(`  ! could not publish "${test.title}": ${JSON.stringify(result.body?.error ?? result.body)}`);
    }
  }
  if (published === 0) log('  · no draft versions left to publish');

  log('');
  log('Demo sign-ins (password: ' + PASSWORD + ')');
  log(`  admin    ${ACCOUNTS.admin.email}`);
  log(`  teacher  ${ACCOUNTS.teacher.email}`);
  log(`  student  ${ACCOUNTS.student.email}`);
}

main().catch((error) => {
  console.error('✗ Demo provisioning failed:', error);
  process.exit(1);
});
