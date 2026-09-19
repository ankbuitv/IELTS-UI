#!/usr/bin/env node
/**
 * End-to-end verification for the sections/parts feature (requirements 28–42).
 * Drives a running Worker over real HTTP and checks:
 *
 *   1. Section builder payload round-trip (types, labels, description,
 *      transcript, image, explicit order) through the admin content API.
 *   2. Section validation errors surface human-readable issues.
 *   3. Catalogue exposes a structure summary computed from real data.
 *   4. An attempt gets server-side section state (progress + sequential
 *      navigation policy) and answers update the per-section counters.
 *   5. Results include per-section performance; review groups by section and
 *      carries the transcript.
 *
 * Usage: node scripts/sections-e2e.mjs   (Worker on :8787)
 */
import process from 'node:process';

const BASE_URL = (process.env.BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const RUN = `sec${Date.now().toString(36)}`;
const PASSWORD = 'Integration-Passw0rd!23';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`    ✓ ${message}`);
  } else {
    failed += 1;
    failures.push(message);
    console.error(`    ✗ ${message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function createClient(label) {
  const cookies = new Map();
  let csrfToken = null;
  async function request(method, path, body, options = {}) {
    const headers = new Headers();
    if (cookies.size > 0) {
      headers.set('cookie', [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    headers.set('origin', BASE_URL);
    if (csrfToken && method !== 'GET' && method !== 'HEAD') headers.set('x-csrf-token', csrfToken);
    let payload;
    if (body !== undefined) {
      headers.set('content-type', 'application/json');
      payload = JSON.stringify(body);
    }
    const response = await fetch(`${BASE_URL}${path}`, { method, headers, body: payload, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookie) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!options.expectStatuses?.includes(response.status) && !response.ok) {
      throw new Error(`${label} ${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
    }
    return { status: response.status, body: json, text };
  }
  return {
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body, options) => request('POST', path, body ?? {}, options),
    patch: (path, body, options) => request('PATCH', path, body ?? {}, options),
    put: (path, body, options) => request('PUT', path, body ?? {}, options),
    async register(email, displayName, bootstrapAdmin = false) {
      const result = await request('POST', '/api/auth/register', { email, password: PASSWORD, displayName, bootstrapAdmin });
      csrfToken = result.body?.csrfToken ?? null;
      return result.body?.user;
    },
    async login(email) {
      const result = await request('POST', '/api/auth/login', { email, password: PASSWORD });
      csrfToken = result.body?.csrfToken ?? null;
      return result.body?.user;
    },
  };
}

const tfngKey = (value) => ({ kind: 'CHOICE', values: [value] });

function readingSection(ordinal, firstNumber) {
  return {
    skill: 'READING',
    type: 'READING_PASSAGE',
    label: `Passage ${ordinal}`,
    title: `The Quiet harbour ${ordinal}`,
    description: `Description for passage ${ordinal}.`,
    instructions: 'Read the passage and answer questions.',
    durationSeconds: 600,
    order: ordinal - 1,
    passage: {
      title: `The Quiet harbour ${ordinal}`,
      paragraphs: [
        { label: 'A', text: `The harbour at dawn is a place of few sounds. ${ordinal} — gulls, water, and the low diesel murmur of a boat preparing to leave.` },
        { label: 'B', text: 'By mid-morning the mood changes: crates, voices and the business of the fish market take over the quayside.' },
      ],
    },
    groups: [
      {
        type: 'TRUE_FALSE_NOT_GIVEN',
        instructions: 'Do the statements agree with the information?',
        questions: [
          { number: firstNumber, prompt: 'The harbour is busiest at dawn.', options: [], config: {}, answerKey: tfngKey('FALSE') },
          { number: firstNumber + 1, prompt: 'The fish market opens in the morning.', options: [], config: {}, answerKey: tfngKey('TRUE') },
        ],
      },
      {
        type: 'SHORT_ANSWER',
        instructions: 'Answer with ONE WORD ONLY.',
        questions: [
          { number: firstNumber + 2, prompt: 'What sound fills the harbour at dawn? [[4]]', options: [], config: { wordLimit: { max: 1 } }, answerKey: { kind: 'TEXT', accept: ['murmur'] } },
        ],
      },
    ],
  };
}

const readingContent = {
  sections: [readingSection(1, 1), readingSection(2, 4)],
  durationSeconds: 1200,
  isCompleteTest: true,
  config: { sectionPolicy: { navigation: 'FREE_NAVIGATION' } },
};

function listeningPart(ordinal, firstNumber) {
  return {
    skill: 'LISTENING',
    type: 'LISTENING_PART',
    label: `Part ${ordinal}`,
    title: `Listening Part ${ordinal}`,
    instructions: 'Complete the notes as you listen.',
    durationSeconds: 300,
    order: ordinal - 1,
    audioUrl: 'https://cdn.example.org/audio/part-' + ordinal + '.mp3',
    transcript: {
      segments: [
        { id: `seg-${ordinal}-1`, startSeconds: 0, speaker: 'Agent', text: 'Good morning, Harbour Services.' },
        { id: `seg-${ordinal}-2`, startSeconds: 9, speaker: 'Caller', text: 'Hello, I would like to book a berth.' },
      ],
    },
    groups: [
      {
        type: 'SHORT_ANSWER',
        instructions: 'Complete the form. ONE WORD AND/OR A NUMBER.',
        questions: [
          { number: firstNumber, prompt: 'Service: harbour ______', options: [], config: { wordLimit: { max: 1 } }, answerKey: { kind: 'TEXT', accept: ['services'] } },
          { number: firstNumber + 1, prompt: 'Request: booking a ______', options: [], config: { wordLimit: { max: 1 } }, answerKey: { kind: 'TEXT', accept: ['berth'] } },
        ],
      },
    ],
  };
}

const listeningContent = {
  sections: [listeningPart(1, 1), listeningPart(2, 3)],
  durationSeconds: 700,
  isCompleteTest: true,
  config: { sectionPolicy: { navigation: 'SEQUENTIAL_PARTS', autoAdvanceOnPartTimeout: false, allowReturnToPreviousParts: true } },
};

const admin = createClient('admin');
const student = createClient('student');

async function createPublishedTest(client, title, type, content) {
  // POST /api/admin/tests creates the test together with its first draft version.
  const created = await client.post('/api/admin/tests', { title, type, summary: `${type} sections test` });
  const testId = created.body.testId;
  const versionId = created.body.versionId;
  const saved = await client.put(`/api/admin/versions/${versionId}/content`, content);
  await client.post(`/api/admin/versions/${versionId}/publish`, { changeNote: 'publish' });
  return { testId, versionId, validation: saved.body.validation };
}

async function main() {
  section('Flow S1 — ADMIN: section builder payload round-trip');
  // The platform only ever bootstraps one administrator; log in when one exists.
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin-mu7obhbt@example.test';
  const adminUser = await admin.login(adminEmail).catch(async () => {
    const created = await admin.register(`${RUN}-admin@example.test`, 'Sections Admin', true);
    return created;
  });
  assert(adminUser?.role === 'ADMIN', `admin signed in (${adminUser?.email ?? 'none'})`);

  const reading = await createPublishedTest(admin, `${RUN} Reading passages`, 'READING', readingContent);
  assert(reading.validation.publishable, 'reading content with 2 labelled passages validates');

  const tree = await admin.get(`/api/admin/versions/${reading.versionId}`);
  assert(tree.body.sections.length === 2, 'admin tree returns both sections');
  assert(tree.body.sections[0].type === 'READING_PASSAGE', 'section type persisted (READING_PASSAGE)');
  assert(tree.body.sections[0].label === 'Passage 1', 'section label persisted');
  assert(tree.body.sections[0].description === 'Description for passage 1.', 'section description persisted');
  assert(tree.body.sections[1].orderIndex === 1, 'explicit order persisted as order_index');

  const listening = await createPublishedTest(admin, `${RUN} Listening parts`, 'LISTENING', listeningContent);
  const listeningTree = await admin.get(`/api/admin/versions/${listening.versionId}`);
  assert(listeningTree.body.sections[0].type === 'LISTENING_PART', 'listening part type persisted');
  assert(
    listeningTree.body.sections[0].transcript?.segments?.length === 2,
    'transcript segments persisted on the listening part',
  );

  section('Flow S2 — ADMIN: section validation reports human-readable errors');
  const bad = admin;
  const badTest = await bad.post('/api/admin/tests', { title: `${RUN} broken`, type: 'WRITING', summary: '' });
  const badVersion = await bad.post(`/api/admin/tests/${badTest.body.testId}/versions`, {});
  await bad.put(`/api/admin/versions/${badVersion.body.versionId}/content`, {
    sections: [
      {
        skill: 'WRITING',
        type: 'WRITING_TASK',
        title: 'Task 1',
        instructions: '',
        groups: [{ type: 'WRITING_TASK_1', instructions: '', sharedOptions: [], config: { minimumWords: 150 }, questions: [{ number: 1, prompt: '', options: [], config: {}, answerKey: { kind: 'MANUAL' } }] }],
      },
    ],
  });
  const badValidation = await bad.post(`/api/admin/versions/${badVersion.body.versionId}/validate`);
  assert(
    badValidation.body.issues.some((issue) => issue.code === 'WRITING_TASK_WITHOUT_PROMPT'),
    'writing task without prompt is reported',
  );

  section('Flow S3 — CATALOG: structure summaries from real data');
  await student.register(`${RUN}-student@example.test`, 'Sections Student', false);
  const catalog = await student.get('/api/tests');
  const readingCard = catalog.body.tests.find((test) => test.title === `${RUN} Reading passages`);
  const listeningCard = catalog.body.tests.find((test) => test.title === `${RUN} Listening parts`);
  assert(readingCard?.structure?.passages === 2, 'reading card reports 2 passages');
  assert(/2 passages.*6 questions.*20 min/.test(readingCard?.structure?.summaryLine ?? ''), `reading summary line: ${readingCard?.structure?.summaryLine}`);
  assert(listeningCard?.structure?.parts === 2, 'listening card reports 2 parts');
  assert(/2 parts.*4 questions/.test(listeningCard?.structure?.summaryLine ?? ''), `listening summary line: ${listeningCard?.structure?.summaryLine}`);

  section('Flow S4 — EXAM: server-side section state and progress');
  const attempt = await student.post('/api/attempts', { testId: readingCard.id });
  const state = await student.get(`/api/attempts/${attempt.body.attemptId}`);
  assert(Array.isArray(state.body.sections) && state.body.sections.length === 2, 'attempt state includes per-section rows');
  assert(state.body.sections[0].status === 'IN_PROGRESS', 'first section starts IN_PROGRESS');
  assert(state.body.sections[0].answeredCount === 0 && state.body.sections[0].totalQuestions === 3, 'section progress counters initialised');
  assert(state.body.sectionPolicy?.navigation === 'FREE_NAVIGATION', 'section policy exposed to the client');

  const firstQuestion = state.body.content.sections[0].groups[0].questions[0];
  await student.patch(`/api/attempts/${attempt.body.attemptId}/answers`, {
    updates: [{ questionId: firstQuestion.id, response: { value: 'FALSE' }, flagged: true }],
  });
  const stateAfter = await student.get(`/api/attempts/${attempt.body.attemptId}`);
  assert(stateAfter.body.sections[0].answeredCount === 1, 'answered_count updated after saving an answer');
  assert(stateAfter.body.sections[0].flaggedCount === 1, 'flagged_count updated after flagging');

  section('Flow S5 — EXAM: sequential listening parts respect the policy');
  const listeningAttempt = await student.post('/api/attempts', { testId: listeningCard.id });
  const listeningState = await student.get(`/api/attempts/${listeningAttempt.body.attemptId}`);
  assert(listeningState.body.sectionPolicy?.navigation === 'SEQUENTIAL_PARTS', 'sequential policy frozen on the attempt');
  assert(listeningState.body.sections[0].deadlineAt !== null, 'part timer derived from section duration');
  const part2Question = listeningState.body.content.sections[1].groups[0].questions[0];
  const earlyAnswer = await student.patch(
    `/api/attempts/${listeningAttempt.body.attemptId}/answers`,
    { updates: [{ questionId: part2Question.id, response: { value: 'berth' } }] },
    { expectStatuses: [200, 403, 409] },
  );
  assert(earlyAnswer.status !== 200, 'answering a future part is rejected in sequential mode');

  const completed = await student.post(`/api/attempts/${listeningAttempt.body.attemptId}/complete-section`, { sectionId: listeningState.body.sections[0].sectionId });
  assert(completed.body.sections?.[0]?.status === 'COMPLETED', 'part 1 marked COMPLETED after complete-section');
  assert(completed.body.sections?.[1]?.status === 'IN_PROGRESS', 'part 2 opened IN_PROGRESS');
  const after = await student.patch(
    `/api/attempts/${listeningAttempt.body.attemptId}/answers`,
    { updates: [{ questionId: part2Question.id, response: { value: 'berth' } }] },
  );
  assert(after.status === 200, 'the now-current part accepts answers');

  section('Flow S6 — RESULTS: per-section performance breakdown');
  // Answer everything, then submit the reading attempt.
  const freshState = await student.get(`/api/attempts/${attempt.body.attemptId}`);
  const updates = [];
  const keys = ['FALSE', 'TRUE', 'murmur', 'FALSE', 'TRUE', 'murmur'];
  let index = 0;
  for (const sectionRow of freshState.body.content.sections) {
    for (const group of sectionRow.groups) {
      for (const question of group.questions) {
        updates.push({ questionId: question.id, response: { value: keys[index % keys.length] } });
        index += 1;
      }
    }
  }
  await student.patch(`/api/attempts/${attempt.body.attemptId}/answers`, { updates });
  await student.post(`/api/attempts/${attempt.body.attemptId}/submit`, { confirmUnanswered: true });
  const result = await student.get(`/api/attempts/${attempt.body.attemptId}/result`);
  const session = result.body.sessions[0];
  assert(Array.isArray(session.sectionResults) && session.sectionResults.length === 2, 'result includes per-section results');
  const passage1 = session.sectionResults.find((row) => row.label === 'Passage 1');
  const passage2 = session.sectionResults.find((row) => row.label === 'Passage 2');
  assert(passage1?.totalQuestions === 3 && passage2?.totalQuestions === 3, 'per-section totals match the structure');
  assert(passage1?.rawScore === 3, `passage 1 scored ${passage1?.rawScore}/3`);
  assert(passage1?.answeredCount === 3, 'per-section answered counts present');
  const reviewItem = session.review?.[0];
  assert(reviewItem?.sectionId && reviewItem.sectionLabel === 'Passage 1', 'review items carry their section label');

  section('Flow S7 — REVIEW: listening review carries transcript and audio');
  await student.post(`/api/attempts/${listeningAttempt.body.attemptId}/submit`, { confirmUnanswered: true });
  const listeningResult = await student.get(`/api/attempts/${listeningAttempt.body.attemptId}/result`);
  const listeningSession = listeningResult.body.sessions[0];
  const part1 = listeningSession.sectionResults.find((row) => row.label === 'Part 1');
  assert(part1?.transcript?.segments?.length === 2, 'review exposes the part transcript');
  assert(Boolean(part1?.audio?.url), 'review exposes the part audio URL');

  console.log(`\n${passed} checks passed, ${failed} failed.`);
  if (failed > 0) {
    console.error(failures.map((message) => `  ✗ ${message}`).join('\n'));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
