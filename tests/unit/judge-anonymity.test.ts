import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Candidates must only ever see "Judge01" and "Judge02". The browser bundle and
 * the shared types are what a candidate's device receives, so none of the code a
 * student can run may name a model, a vendor or an endpoint. (The admin console
 * legitimately configures providers, so it is the one exception.)
 */
describe('judge anonymity', () => {
  const studentFacing = [
    ...files(join(root, 'src/client')).filter((file) => !file.includes('/pages/admin/')),
    ...files(join(root, 'src/shared')),
  ].filter((file) => !/(\/shared\/ai\.ts|\/shared\/types\.ts)$/.test(file));

  it('keeps model and vendor names out of every file a candidate downloads', () => {
    const offenders: string[] = [];
    for (const file of studentFacing) {
      const text = readFileSync(file, 'utf8');
      if (/gpt-oss|gemma|ollama\.com|openai|deepseek|qwen/i.test(text)) offenders.push(relative(root, file));
    }
    expect(offenders).toEqual([]);
  });

  it('never puts the real model behind a judge into an API payload type', () => {
    for (const file of ['src/shared/judges.ts', 'src/client/pages/student/SpeakingPage.tsx', 'src/client/components/ResultView.tsx']) {
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(/providerModel|provider_model/);
    }
  });

  it('shows the two labels the candidate is promised', () => {
    const judges = readFileSync(join(root, 'src/shared/judges.ts'), 'utf8');
    expect(judges).toContain("'Judge01'");
    expect(judges).toContain("'Judge02'");
  });
});
