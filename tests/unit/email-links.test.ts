import { describe, expect, it } from 'vitest';
import { appUrl, emailLayout, loginOtpEmail, magicLinkEmail, passwordResetEmail } from '../../src/worker/services/email-service';
import type { Env } from '../../src/worker/env';

const env = { APP_BASE_URL: 'https://ielts.example.com/' } as Env;

describe('transactional email templates', () => {
  it('builds absolute URLs against the configured base', () => {
    expect(appUrl(env, '/auth/magic?token=abc')).toBe('https://ielts.example.com/auth/magic?token=abc');
    expect(appUrl({ APP_BASE_URL: '' } as Env, '/reset-password')).toBe('/reset-password');
  });

  it('carries the single-use token and its lifetime in the magic link', () => {
    const message = magicLinkEmail(env, 'tok_123');
    expect(message.url).toBe('https://ielts.example.com/auth/magic?token=tok_123');
    expect(message.html).toContain('15 phút');
    expect(message.html).toContain('một lần');
    expect(message.text).toContain(message.url);
  });

  it('uses a longer window for password resets', () => {
    const message = passwordResetEmail(env, 'tok_456');
    expect(message.url).toContain('/reset-password?token=tok_456');
    expect(message.html).toContain('30 phút');
  });

  it('escapes untrusted text and shows the code prominently', () => {
    const heading = emailLayout({ heading: '<b>Hi</b>', body: '<p>ok</p>', cta: { label: 'Go <now>', href: 'https://x.test/?a=1&b=2' } });
    expect(heading).toContain('&lt;b&gt;Hi&lt;/b&gt;');
    expect(heading).toContain('Go &lt;now&gt;');
    expect(heading).toContain('a=1&amp;b=2');

    const otp = loginOtpEmail(env, 'ABCD2345');
    expect(otp.subject).toContain('ABCD2345');
    expect(otp.html).toContain('ABCD2345');
  });
});
