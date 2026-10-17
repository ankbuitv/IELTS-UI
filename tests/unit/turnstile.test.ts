import { describe, expect, it } from 'vitest';
import { TURNSTILE_FAILURE_MESSAGE, turnstileEnabled, verifyTurnstile } from '../../src/worker/lib/turnstile';

describe('Cloudflare Turnstile gate', () => {
  it('stays inert until both keys are configured', () => {
    expect(turnstileEnabled({})).toBe(false);
    expect(turnstileEnabled({ TURNSTILE_SITE_KEY: '0x4AAA' })).toBe(false);
    expect(turnstileEnabled({ TURNSTILE_SITE_KEY: '0x4AAA', TURNSTILE_SECRET_KEY: 'secret' })).toBe(true);
  });

  it('does not ask a network question when it is not configured', async () => {
    // No fetch stub: if this ever reached the network the test would fail loudly.
    await expect(verifyTurnstile({}, 'whatever', { action: 'LOGIN' })).resolves.toEqual({ status: 'ok' });
  });

  it('refuses a missing or obviously short token before calling Cloudflare', async () => {
    const env = { TURNSTILE_SITE_KEY: '0x4AAA', TURNSTILE_SECRET_KEY: 'secret' };
    await expect(verifyTurnstile(env, undefined, { action: 'LOGIN' })).resolves.toMatchObject({
      status: 'rejected',
      codes: ['missing-input-response'],
    });
    await expect(verifyTurnstile(env, 'nope', { action: 'LOGIN' })).resolves.toMatchObject({ status: 'rejected' });
  });

  it('reports one candidate-safe message for every rejection', () => {
    expect(TURNSTILE_FAILURE_MESSAGE).toMatch(/robot/i);
    expect(TURNSTILE_FAILURE_MESSAGE).not.toMatch(/token|secret|sitekey/i);
  });
});
