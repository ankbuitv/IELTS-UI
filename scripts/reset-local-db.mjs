#!/usr/bin/env node
/**
 * Rebuilds the LOCAL development database from scratch:
 *
 *   1. delete every row   (seed/wipe.sql)
 *   2. apply migrations   (migrations/*.sql)
 *   3. load sample content (seed/seed.sql)
 *
 * It never touches the remote database. Media is stored as external URLs and
 * bundled demo files, so nothing outside D1 needs cleaning up.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

const root = new URL('..', import.meta.url).pathname;
const wrangler = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(args, label) {
  console.log(`\n▸ ${label}`);
  const result = spawnSync(wrangler, ['wrangler', ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${result.status ?? 'unknown'}).`);
    process.exit(result.status ?? 1);
  }
}

for (const file of ['seed/wipe.sql', 'seed/seed.sql']) {
  if (!existsSync(new URL(`../${file}`, import.meta.url))) {
    console.error(`Missing ${file}.`);
    process.exit(1);
  }
}

run(['d1', 'migrations', 'apply', 'DB', '--local'], 'Applying migrations');
run(['d1', 'execute', 'DB', '--local', '--file=./seed/wipe.sql'], 'Clearing local tables');
run(['d1', 'execute', 'DB', '--local', '--file=./seed/seed.sql'], 'Loading original sample content');

console.log('\n✓ Local database rebuilt. The first account to register becomes the administrator.');
console.log('  Start the Worker with `npm run dev`, then open http://localhost:8787/.');
