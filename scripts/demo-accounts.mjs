#!/usr/bin/env node
/**
 * Provisions the local *development* database with demo accounts and makes the
 * seeded sample content usable, so a fresh checkout (or a fresh sandbox, where
 * `.wrangler/` state does not survive) has a working application instead of an
 * empty catalogue:
 *
 *   1. ensures the bootstrap administrator exists,
 *   2. creates a TEACHER and a STUDENT account (idempotent),
 *   3. publishes the original sample tests that ship as DRAFT in seed/seed.sql.
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
    useSession: (token, csrf) => {
      sessionToken = token;
      csrfToken = csrf;
    },
    get csrfToken() {
      return csrfToken;
    },
  };
}

const log = (...args) => console.log(...args);

async function ensureAccount(client, account, { registerPath = '/api/auth/register' } = {}) {
  const payload = {
    email: account.email,
    password: PASSWORD,
    displayName: account.displayName,
    bootstrapAdmin: account.role === 'ADMIN',
  };

  const registered = await client.post(registerPath, payload);
  if (registered.status === 201) return { created: true, ...registered };

  const loggedIn = await client.post('/api/auth/login', { email: account.email, password: PASSWORD });
  if (loggedIn.status === 200) return { created: false, ...loggedIn };

  return { created: false, status: loggedIn.status, body: loggedIn.body };
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
  admin.useSession(adminAccount.body.sessionToken ?? null, adminAccount.body.csrfToken ?? null);
  log(`  ✓ admin    ${ACCOUNTS.admin.email} (${adminAccount.created ? 'created' : 'existing'})`);

  // 2. Teacher, created by the administrator (public sign-up only makes students).
  const teacher = createClient();
  const teacherAccount = await ensureAccount(teacher, ACCOUNTS.teacher);
  if (!teacherAccount.body?.user) {
    const created = await admin.post('/api/admin/users', {
      email: ACCOUNTS.teacher.email,
      displayName: ACCOUNTS.teacher.displayName,
      role: 'TEACHER',
      password: PASSWORD,
    });
    if (created.status !== 201) {
      log(`  · teacher  ${ACCOUNTS.teacher.email} present already (${created.status})`);
    } else {
      log(`  ✓ teacher  ${ACCOUNTS.teacher.email} (created)`);
    }
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

  // 4. Publish the sample content so /practice is not empty.
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
