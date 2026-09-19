#!/usr/bin/env node
/**
 * Prints `vars.APP_BASE_URL` from wrangler.jsonc.
 *
 * Deployment automation needs the public origin of the Worker (for the
 * post-deploy smoke test) and the single source of truth for it is the Worker
 * configuration. Node cannot `require()` a JSONC file, so the one value is read
 * with a targeted match instead of a hand-rolled comment stripper — this file
 * only ever needs that value, and a partial JSONC parser would be a liability.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

const configPath = new URL('../wrangler.jsonc', import.meta.url);
const text = readFileSync(configPath, 'utf8');

const match = /"APP_BASE_URL"\s*:\s*"([^"]+)"/.exec(text);
if (!match) {
  console.error('wrangler.jsonc has no vars.APP_BASE_URL.');
  process.exit(1);
}

process.stdout.write(match[1]);
