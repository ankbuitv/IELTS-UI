#!/usr/bin/env node
/**
 * One-command development start-up.
 *
 * A local D1 database lives in `.wrangler/state`, which is git-ignored and not
 * carried between machines (or between sandboxes and CI containers). Starting
 * the Worker against a database that has never been migrated is why a fresh
 * checkout used to greet you with "The platform database is not initialised
 * yet": the tables are created on first request, but the sample content is not.
 *
 * This wrapper therefore:
 *
 *   1. applies the D1 migrations (idempotent), and loads `seed/seed.sql` when
 *      the local database has no tests yet;
 *   2. starts `wrangler dev` on 0.0.0.0:8787 and waits until it answers
 *      `/api/health`;
 *   3. provisions the demo accounts and publishes the sample content
 *      (`scripts/demo-accounts.mjs`, idempotent, development only).
 *
 * Nothing here is used in production: `npm run deploy` still builds and deploys
 * the Worker exactly as before.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

const root = new URL('..', import.meta.url).pathname;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const port = process.env.PORT ?? '8787';
const base = `http://127.0.0.1:${port}`;

function wrangler(args, { capture = false, label } = {}) {
  if (label) console.log(`\n▸ ${label}`);
  return spawnSync(npx, ['wrangler', ...args], {
    cwd: root,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
}

/** Row count for a table, or `null` when the table does not exist yet. */
function countRows(table) {
  const result = wrangler(
    ['d1', 'execute', 'DB', '--local', '--json', '--command', `SELECT COUNT(*) AS count FROM ${table}`],
    { capture: true },
  );
  if (result.status !== 0) return null;
  const output = `${result.stdout ?? ''}`;
  const start = output.indexOf('[');
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(output.slice(start));
    const value = parsed?.[0]?.results?.[0]?.count;
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

async function waitForWorker(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        const body = await response.json();
        if (body?.database?.reachable) return true;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

console.log('▸ Preparing the local database');
if (!existsSync(`${root}.wrangler/state`)) {
  console.log('  · no local D1 state found — migrating and seeding from scratch');
} else {
  console.log('  · local D1 state found — re-applying migrations, checking sample content');
}

const migrated = wrangler(['d1', 'migrations', 'apply', 'DB', '--local']);
if (migrated.status !== 0) {
  console.error('✗ Migrations failed. Fix the error above and try again.');
  process.exit(migrated.status ?? 1);
}

const testCount = countRows('tests');
if (testCount === null || testCount === 0) {
  console.log('  · loading the original sample content (seed/seed.sql)');
  const seeded = wrangler(['d1', 'execute', 'DB', '--local', '--file=./seed/seed.sql']);
  if (seeded.status !== 0) {
    console.error('✗ Loading the sample content failed. Fix the error above and try again.');
    process.exit(seeded.status ?? 1);
  }
} else {
  console.log(`  · ${testCount} test(s) already in the database — keeping the existing content`);
}

console.log(`\n▸ Starting the Worker on ${base}`);
const server = spawn(npx, ['wrangler', 'dev', '--port', port, '--ip', '0.0.0.0'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shuttingDown = true;
    server.kill(signal);
  });
}

const ready = await waitForWorker();
if (!ready) {
  console.error('✗ The Worker did not become healthy in time. See the log above.');
} else {
  console.log('\n▸ Provisioning demo accounts and publishing the sample content');
  const demo = spawnSync(process.execPath, [`${root}scripts/demo-accounts.mjs`], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, DEMO_BASE_URL: base },
  });
  if (demo.status !== 0) {
    console.warn('! Demo provisioning did not finish. The application is still usable.');
  }
  console.log('\n✓ Ready. Open the application and sign in with a demo account above.');
}

server.on('exit', (code) => {
  process.exit(shuttingDown ? 0 : code ?? 0);
});
