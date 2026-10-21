/**
 * Billing API.
 *
 * The Stripe webhook is mounted before the session middleware: Stripe has no
 * cookie and proves itself with a signature instead. Every other endpoint is
 * session-scoped, same-origin and CSRF-protected like the rest of the app.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { assertCsrf, assertSameOrigin, clientIp } from '../lib/http';
import { enforceRateLimit } from '../lib/rate-limit';
import { parseBody } from '../lib/validate';
import { currentUser, requireAuth } from '../middleware/auth';
import {
  cancelOrder,
  cancelSubscription,
  getBillingState,
  handleStripeEvent,
  startCheckout,
  verifyStripeSignature,
} from '../services/billing-service';

export const billingRouter = new Hono<AppBindings>();

/** Stripe signs the exact bytes it sent, so read text before parsing. */
billingRouter.post('/stripe/webhook', async (c) => {
  const raw = await c.req.text();
  const secret = c.env.STRIPE_WEBHOOK_SECRET ?? '';
  const signature = c.req.header('stripe-signature') ?? null;
  if (!secret) throw ApiError.conflict('Stripe webhooks are not configured.');
  const valid = await verifyStripeSignature(raw, signature, secret);
  if (!valid) throw ApiError.forbidden('Invalid Stripe signature.');
  const result = await handleStripeEvent(c.env, raw);
  return c.json({ received: true, ...result });
});

billingRouter.use('*', requireAuth);

billingRouter.get('/', async (c) => {
  const user = currentUser(c);
  return c.json(await getBillingState(c.env, user.id, new Date().toISOString().slice(0, 10)));
});

const checkoutSchema = z.object({
  plan: z.string().min(2).max(40),
  provider: z.enum(['CARD', 'BANK', 'DEMO']),
});

billingRouter.post('/checkout', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await enforceRateLimit(
    c.env,
    { bucket: `billing:${user.id}:${clientIp(c)}`, limit: 8, windowSeconds: 15 * 60 },
    'Too many checkout attempts. Wait a few minutes and try again.',
  );
  const body = await parseBody(c, checkoutSchema);
  const origin = c.req.header('origin');
  const baseUrl = origin && /^https?:\/\//.test(origin) ? origin : c.env.APP_BASE_URL.replace(/\/$/, '');
  return c.json(await startCheckout(c.env, user.id, body.plan, body.provider, baseUrl));
});

billingRouter.post('/orders/:orderId/cancel', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  return c.json({ order: await cancelOrder(c.env, user.id, c.req.param('orderId')) });
});

billingRouter.post('/subscription/cancel', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  return c.json({ subscription: await cancelSubscription(c.env, user.id) });
});

billingRouter.get('/pro', async (c) => {
  const user = currentUser(c);
  const state = await getBillingState(c.env, user.id, new Date().toISOString().slice(0, 10));
  return c.json({ pro: state.subscription.pro, subscription: state.subscription });
});
