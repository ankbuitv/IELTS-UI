/**
 * Subscriptions and orders.
 *
 * A checkout always starts from a plan id in `shared/billing.ts`; the amount
 * is read there, never from the request. Three providers are supported:
 *
 * - `CARD` creates a Stripe Checkout Session and redirects the browser. The
 *   order becomes PAID only when the signed webhook arrives, so a learner who
 *   abandons the Stripe page never gains access.
 * - `BANK` creates a PENDING order with a unique transfer reference. An
 *   administrator confirms it after the transfer lands. This is the honest
 *   path for VNPay/MoMo wallets until merchant credentials exist.
 * - `DEMO` is accepted only outside production and activates immediately, so
 *   the preview can walk through the whole flow.
 *
 * All activation goes through `markOrderPaid`, which is idempotent: a Stripe
 * retry, a double-click and an admin confirmation can race without granting
 * two periods.
 */
import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { notify } from './notification-service';
import {
  PLANS,
  formatVnd,
  isPaymentProvider,
  isPlanId,
  planById,
  periodEndFor,
  subscriptionIsActive,
  type AdminBillingOrder,
  type AdminBillingOrders,
  type BillingOrder,
  type BillingState,
  type CheckoutResult,
  type OrderStatus,
  type PaymentProvider,
  type Plan,
  type SubscriptionView,
} from '../../shared/billing';
import { seasonOf } from '../../shared/season';

interface OrderRow {
  id: string;
  user_id: string;
  plan_id: string;
  provider: string;
  status: string;
  amount_vnd: number;
  reference: string;
  checkout_url: string | null;
  instructions: string;
  created_at: string;
  paid_at: string | null;
}

interface SubscriptionRow {
  user_id: string;
  plan_id: string;
  status: string;
  provider: string;
  current_period_end: string;
  started_at: string;
  updated_at: string;
}

const ORDER_LIMIT = 25;

function toOrder(row: OrderRow): BillingOrder {
  const plan = planById(row.plan_id);
  return {
    id: row.id,
    planId: isPlanId(row.plan_id) ? row.plan_id : null,
    planName: plan?.name ?? row.plan_id,
    provider: isPaymentProvider(row.provider) ? row.provider : 'BANK',
    status: (['PENDING', 'PAID', 'CANCELLED', 'EXPIRED'].includes(row.status) ? row.status : 'PENDING') as OrderStatus,
    amountVnd: row.amount_vnd,
    reference: row.reference,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    redirectUrl: row.checkout_url,
    instructions: row.instructions || null,
  };
}

function bankInstructions(env: Env, plan: Plan, reference: string): string {
  const bank = env.BILLING_BANK_NAME?.trim() || '';
  const account = env.BILLING_BANK_ACCOUNT?.trim() || '';
  const holder = env.BILLING_BANK_HOLDER?.trim() || '';
  if (!bank || !account) {
    return `Bank transfer is not configured on this deployment. Order ${reference} for ${formatVnd(plan.priceVnd)} is reserved; an administrator can still confirm it.`;
  }
  return [
    `Transfer ${formatVnd(plan.priceVnd)} to ${bank} · ${account}${holder ? ` (${holder})` : ''}.`,
    `Use the reference ${reference}. Your plan activates once an administrator confirms the transfer (usually within one working day).`,
  ].join(' ');
}

/** Reference printed on the transfer; uppercase so it survives copy/paste. */
function newReference(): string {
  return `IELTS-${newId('', 6).replace(/_/g, '').toUpperCase()}`;
}

export async function readSubscription(env: Env, userId: string, now = nowIso()): Promise<SubscriptionView> {
  const row = await env.DB.prepare('SELECT * FROM user_subscriptions WHERE user_id = ?')
    .bind(userId)
    .first<SubscriptionRow>();
  if (!row) {
    return {
      pro: false,
      planId: null,
      planName: null,
      status: 'NONE',
      currentPeriodEnd: null,
      provider: null,
      expired: false,
      cancelAtPeriodEnd: false,
    };
  }
  const plan = planById(row.plan_id);
  const active = subscriptionIsActive(row.status, row.current_period_end, now);
  if (row.status === 'ACTIVE' && !active) {
    await env.DB.prepare("UPDATE user_subscriptions SET status = 'EXPIRED', updated_at = ? WHERE user_id = ? AND status = 'ACTIVE'")
      .bind(now, userId)
      .run();
  }
  return {
    pro: active,
    planId: isPlanId(row.plan_id) ? row.plan_id : null,
    planName: plan?.name ?? row.plan_id,
    status: active ? 'ACTIVE' : row.status === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED',
    currentPeriodEnd: row.current_period_end,
    provider: isPaymentProvider(row.provider) ? row.provider : null,
    expired: !active,
    cancelAtPeriodEnd: row.status === 'CANCELLED' && active,
  };
}

/**
 * Stop the renewal. Access is deliberately not removed: the learner paid for
 * the period, and `subscriptionIsActive` keeps CANCELLED rows live until the
 * period end.
 */
export async function cancelSubscription(env: Env, userId: string): Promise<SubscriptionView> {
  const current = await readSubscription(env, userId);
  if (!current.pro) throw ApiError.conflict('There is no active subscription to cancel.');
  const now = nowIso();
  await env.DB.prepare("UPDATE user_subscriptions SET status = 'CANCELLED', updated_at = ? WHERE user_id = ? AND status = 'ACTIVE'")
    .bind(now, userId)
    .run();
  return readSubscription(env, userId);
}

export async function isPro(env: Env, userId: string): Promise<boolean> {
  const subscription = await readSubscription(env, userId);
  return subscription.pro;
}

export async function getBillingState(env: Env, userId: string, day: string): Promise<BillingState> {
  const [subscription, orders] = await Promise.all([
    readSubscription(env, userId),
    env.DB.prepare('SELECT * FROM billing_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(userId, ORDER_LIMIT)
      .all<OrderRow>(),
  ]);
  return {
    subscription,
    orders: (orders.results ?? []).map(toOrder),
    season: seasonOf(day),
    cardAvailable: Boolean(env.STRIPE_SECRET_KEY),
    demoAvailable: env.APP_ENV !== 'production',
  };
}

export async function startCheckout(
  env: Env,
  userId: string,
  planId: string,
  provider: PaymentProvider,
  baseUrl: string,
): Promise<CheckoutResult> {
  if (!isPlanId(planId)) throw ApiError.validation('That plan does not exist.');
  const plan = planById(planId)!;
  if (!isPaymentProvider(provider)) throw ApiError.validation('Choose a payment method.');
  if (provider === 'DEMO' && env.APP_ENV === 'production') {
    throw ApiError.forbidden('Demo activation is not available.');
  }
  if (provider === 'CARD' && !env.STRIPE_SECRET_KEY) {
    throw ApiError.conflict('Card payment is not configured yet. Use a bank transfer and an administrator will confirm it.');
  }

  const current = await readSubscription(env, userId);
  if (current.pro) throw ApiError.conflict('Pro is already active on this account.');

  const now = nowIso();
  const orderId = newId('ord');
  const reference = newReference();
  const instructions = provider === 'BANK' ? bankInstructions(env, plan, reference) : '';
  const status: OrderStatus = provider === 'BANK' ? 'PENDING' : 'PENDING';

  await env.DB.prepare(
    `INSERT INTO billing_orders
       (id, user_id, plan_id, provider, status, amount_vnd, reference, checkout_url, provider_ref, instructions, created_at, paid_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?)`,
  )
    .bind(
      orderId,
      userId,
      plan.id,
      provider,
      status,
      plan.priceVnd,
      reference,
      instructions,
      now,
      new Date(Date.now() + 48 * 3_600_000).toISOString(),
    )
    .run();

  let checkoutUrl: string | null = null;
  if (provider === 'CARD') {
    const session = await createStripeSession(env, { orderId, plan, reference, baseUrl });
    checkoutUrl = session.url;
    await env.DB.prepare('UPDATE billing_orders SET checkout_url = ?, provider_ref = ? WHERE id = ?')
      .bind(session.url, session.id, orderId)
      .run();
  }

  if (provider === 'DEMO') {
    await markOrderPaid(env, orderId, 'demo');
    checkoutUrl = null;
  }

  const row = await env.DB.prepare('SELECT * FROM billing_orders WHERE id = ?').bind(orderId).first<OrderRow>();
  return { order: toOrder(row!), redirectUrl: checkoutUrl };
}

interface StripeSession {
  id: string;
  url: string;
}

async function createStripeSession(
  env: Env,
  input: { orderId: string; plan: Plan; reference: string; baseUrl: string },
): Promise<StripeSession> {
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('client_reference_id', input.orderId);
  body.set('metadata[orderId]', input.orderId);
  body.set('metadata[reference]', input.reference);
  body.set('success_url', `${input.baseUrl}/pricing?status=success&order=${encodeURIComponent(input.orderId)}`);
  body.set('cancel_url', `${input.baseUrl}/pricing?status=cancelled&order=${encodeURIComponent(input.orderId)}`);
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'vnd');
  body.set('line_items[0][price_data][unit_amount]', String(input.plan.priceVnd));
  body.set('line_items[0][price_data][product_data][name]', input.plan.name);

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': input.orderId,
    },
    body,
  });
  const payload = (await response.json().catch(() => null)) as { id?: string; url?: string; error?: { message?: string } } | null;
  if (!response.ok || !payload?.id || !payload.url) {
    console.error('stripe_session_failed', response.status, payload?.error?.message ?? 'unknown');
    throw ApiError.conflict('Stripe could not start the payment. Please try again or use a bank transfer.');
  }
  return { id: payload.id, url: payload.url };
}

/**
 * Mark an order paid and extend the subscription.
 *
 * Returns the subscription view. A second call for the same order is a no-op
 * beyond repairing a missing subscription row, which keeps webhook retries and
 * an administrator confirming the same transfer safe.
 */
export async function markOrderPaid(env: Env, orderId: string, providerRef?: string | null): Promise<SubscriptionView> {
  const order = await env.DB.prepare('SELECT * FROM billing_orders WHERE id = ?').bind(orderId).first<OrderRow>();
  if (!order) throw ApiError.notFound('That order does not exist.');
  if (order.status === 'PAID') return readSubscription(env, order.user_id);

  const plan = planById(order.plan_id);
  if (!plan) throw ApiError.validation('That order refers to an unknown plan.');

  const now = nowIso();
  await env.DB.prepare("UPDATE billing_orders SET status = 'PAID', paid_at = ?, provider_ref = COALESCE(?, provider_ref) WHERE id = ? AND status = 'PENDING'")
    .bind(now, providerRef ?? null, orderId)
    .run();

  const existing = await env.DB.prepare('SELECT * FROM user_subscriptions WHERE user_id = ?')
    .bind(order.user_id)
    .first<SubscriptionRow>();
  const from =
    existing && Date.parse(existing.current_period_end) > Date.parse(now)
      ? existing.current_period_end
      : now;
  const periodEnd = periodEndFor(plan, from);

  await env.DB.prepare(
    `INSERT INTO user_subscriptions (user_id, plan_id, status, provider, current_period_end, started_at, updated_at, order_id)
     VALUES (?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       plan_id = excluded.plan_id,
       status = 'ACTIVE',
       provider = excluded.provider,
       current_period_end = excluded.current_period_end,
       updated_at = excluded.updated_at,
       order_id = excluded.order_id`,
  )
    .bind(order.user_id, plan.id, order.provider, periodEnd, now, now, orderId)
    .run();

  await notify(env, {
    userId: order.user_id,
    kind: 'BILLING',
    title: `${plan.name} is active`,
    body: `Pro runs until ${periodEnd.slice(0, 10)}. Thank you for supporting the platform.`,
    href: '/pricing',
  });

  return readSubscription(env, order.user_id);
}

export async function cancelOrder(env: Env, userId: string, orderId: string): Promise<BillingOrder> {
  const row = await env.DB.prepare('SELECT * FROM billing_orders WHERE id = ? AND user_id = ?')
    .bind(orderId, userId)
    .first<OrderRow>();
  if (!row) throw ApiError.notFound('That order does not exist.');
  if (row.status !== 'PENDING') throw ApiError.conflict('Only a pending order can be cancelled.');
  await env.DB.prepare("UPDATE billing_orders SET status = 'CANCELLED' WHERE id = ? AND status = 'PENDING'").bind(orderId).run();
  return toOrder({ ...row, status: 'CANCELLED' });
}

/** Stripe signs `${timestamp}.${rawBody}`; compare every v1 candidate. */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(',').map((part) => part.trim());
  const timestamp = Number(parts.find((part) => part.startsWith('t='))?.slice(2));
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return signatures.some((signature) => signature.length === expected.length && timingSafeEqual(signature, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

/** Handle the two Stripe events that mean "money arrived". */
export async function handleStripeEvent(env: Env, rawBody: string): Promise<{ handled: boolean }> {
  let event: {
    type?: string;
    data?: { object?: { client_reference_id?: string; metadata?: { orderId?: string }; id?: string; payment_status?: string } };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw ApiError.validation('Invalid Stripe payload.');
  }
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return { handled: false };
  }
  const object = event.data?.object;
  const orderId = object?.client_reference_id ?? object?.metadata?.orderId;
  if (!orderId) return { handled: false };
  if (event.type === 'checkout.session.completed' && object?.payment_status && object.payment_status !== 'paid') {
    return { handled: false };
  }
  await markOrderPaid(env, orderId, object?.id ?? null);
  return { handled: true };
}

/** Admin queue: newest first, optionally only pending orders. */
export async function listAllOrders(env: Env, status?: OrderStatus): Promise<AdminBillingOrders> {
  const where = status ? 'WHERE o.status = ?' : '';
  const statement = env.DB.prepare(
    `SELECT o.*, u.email AS user_email,
            COALESCE(NULLIF(up.display_name, ''), u.username, 'Learner') AS user_name
       FROM billing_orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       ${where}
      ORDER BY o.created_at DESC
      LIMIT 100`,
  );
  const rows = await (status ? statement.bind(status) : statement).all<OrderRow & { user_email: string; user_name: string }>();
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM billing_orders WHERE status = 'PENDING'").first<{ n: number }>();
  return {
    orders: (rows.results ?? []).map((row) => ({
      ...toOrder(row),
      userId: row.user_id,
      userEmail: row.user_email,
      userName: row.user_name,
    })) satisfies AdminBillingOrder[],
    pending: pending?.n ?? 0,
  };
}

export const BILLING_PLAN_COUNT = PLANS.length;
