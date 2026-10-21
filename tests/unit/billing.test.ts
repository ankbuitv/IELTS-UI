import { describe, expect, it } from 'vitest';
import {
  PLANS,
  addMonths,
  formatVnd,
  isPaymentProvider,
  isPlanId,
  planById,
  periodEndFor,
  subscriptionIsActive,
} from '../../src/shared/billing';
import { verifyStripeSignature } from '../../src/worker/services/billing-service';

describe('billing plans', () => {
  it('prices both plans in VND and marks the yearly one as featured', () => {
    expect(PLANS).toHaveLength(2);
    expect(planById('pro_monthly')?.priceVnd).toBe(199_000);
    expect(planById('pro_yearly')?.months).toBe(12);
    expect(PLANS.filter((plan) => plan.featured)).toHaveLength(1);
  });

  it('validates plan and provider ids', () => {
    expect(isPlanId('pro_monthly')).toBe(true);
    expect(isPlanId('pro_weekly')).toBe(false);
    expect(isPaymentProvider('BANK')).toBe(true);
    expect(isPaymentProvider('CASH')).toBe(false);
  });

  it('formats dong with Vietnamese separators', () => {
    expect(formatVnd(1_590_000)).toMatch(/1[.,]590[.,]000\s₫/);
  });

  it('adds months without rolling past the end of a short month', () => {
    expect(addMonths('2026-01-31T10:00:00.000Z', 1)).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths('2024-01-31T10:00:00.000Z', 1)).toBe('2024-02-29T10:00:00.000Z');
    expect(addMonths('2026-11-30T00:00:00.000Z', 3)).toBe('2027-02-28T00:00:00.000Z');
  });

  it('runs a yearly plan for twelve months', () => {
    const yearly = planById('pro_yearly')!;
    expect(periodEndFor(yearly, '2026-01-15T00:00:00.000Z')).toBe('2027-01-15T00:00:00.000Z');
  });

  it('treats a lapsed period as inactive', () => {
    expect(subscriptionIsActive('ACTIVE', '2026-11-01T00:00:00.000Z', '2026-10-19T00:00:00.000Z')).toBe(true);
    expect(subscriptionIsActive('ACTIVE', '2026-10-01T00:00:00.000Z', '2026-10-19T00:00:00.000Z')).toBe(false);
    // Cancelling stops the renewal, not the access the learner already paid for.
    expect(subscriptionIsActive('CANCELLED', '2026-11-01T00:00:00.000Z', '2026-10-19T00:00:00.000Z')).toBe(true);
    expect(subscriptionIsActive('CANCELLED', '2026-10-01T00:00:00.000Z', '2026-10-19T00:00:00.000Z')).toBe(false);
    expect(subscriptionIsActive(null, null, '2026-10-19T00:00:00.000Z')).toBe(false);
  });
});

describe('stripe signatures', () => {
  const secret = 'whsec_test_secret';

  async function sign(body: string, timestamp: number): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  it('accepts a correctly signed payload inside the tolerance', async () => {
    const body = '{"type":"checkout.session.completed"}';
    const now = 1_700_000_000;
    const header = `t=${now},v1=${await sign(body, now)}`;
    await expect(verifyStripeSignature(body, header, secret, now)).resolves.toBe(true);
  });

  it('rejects a tampered body, a stale timestamp and an unsigned request', async () => {
    const body = '{"type":"checkout.session.completed"}';
    const now = 1_700_000_000;
    const header = `t=${now},v1=${await sign(body, now)}`;
    await expect(verifyStripeSignature(`${body} `, header, secret, now)).resolves.toBe(false);
    await expect(verifyStripeSignature(body, header, secret, now + 3600)).resolves.toBe(false);
    await expect(verifyStripeSignature(body, null, secret, now)).resolves.toBe(false);
    await expect(verifyStripeSignature(body, `t=${now},v1=deadbeef`, secret, now)).resolves.toBe(false);
  });

  it('accepts any matching v1 signature when Stripe rotates the secret', async () => {
    const body = '{}';
    const now = 1_700_000_000;
    const header = `t=${now},v1=00,t=${now},v1=${await sign(body, now)}`;
    await expect(verifyStripeSignature(body, header, secret, now)).resolves.toBe(true);
  });
});
