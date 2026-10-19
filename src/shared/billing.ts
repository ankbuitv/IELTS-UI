/**
 * Subscription plans and the shapes the billing screens render.
 *
 * Prices are held in Vietnamese dong, the currency the product sells in. The
 * Worker never trusts a price sent by the browser: a checkout request names a
 * plan id and the amount is read from this table.
 *
 * Payment providers are intentionally narrow:
 * - `CARD` goes to Stripe Checkout when the deployment has keys. Without keys
 *   it answers with a configuration message rather than pretending to charge.
 * - `BANK` is a manual bank transfer. The order is created as PENDING and an
 *   administrator marks it paid after the transfer lands. This is the path
 *   that works for VNPay/MoMo-style wallets without merchant credentials.
 * - `DEMO` activates a plan immediately and is only accepted by a
 *   non-production Worker, so the flow can be walked through in preview.
 */
import type { SeasonInfo } from './season';

export const PLAN_IDS = ['pro_monthly', 'pro_yearly'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  /** Charge in VND. */
  priceVnd: number;
  /** Equivalent monthly price, for the yearly card. */
  monthlyEquivalentVnd: number;
  months: number;
  blurb: string;
  perks: string[];
  /** Highlighted on the pricing grid. */
  featured?: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'pro_monthly',
    name: 'Pro monthly',
    priceVnd: 199_000,
    monthlyEquivalentVnd: 199_000,
    months: 1,
    blurb: 'Everything unlocked, month to month.',
    perks: [
      'Unlimited AI speaking-partner turns',
      'Unlimited question-type drills',
      'Full score history and band projection',
      'Season pass and class league',
    ],
  },
  {
    id: 'pro_yearly',
    name: 'Pro yearly',
    priceVnd: 1_590_000,
    monthlyEquivalentVnd: 132_500,
    months: 12,
    blurb: 'Two months free, one decision a year.',
    perks: [
      'Everything in Pro monthly',
      'Save 33% against monthly',
      'Priority AI marking queue',
      'Cancel any time; access runs to the period end',
    ],
    featured: true,
  },
] as const;

export const PAYMENT_PROVIDERS = ['CARD', 'BANK', 'DEMO'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const ORDER_STATUSES = ['PENDING', 'PAID', 'CANCELLED', 'EXPIRED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function isPaymentProvider(value: unknown): value is PaymentProvider {
  return typeof value === 'string' && (PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

export function planById(id: string): Plan | null {
  return PLANS.find((plan) => plan.id === id) ?? null;
}

export function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString('vi-VN')} ₫`;
}

/** Add calendar months in UTC, keeping the time of day. */
export function addMonths(iso: string, months: number): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

/** When a plan bought or renewed now should run until. */
export function periodEndFor(plan: Plan, fromIso: string): string {
  return addMonths(fromIso, plan.months);
}

export interface SubscriptionView {
  pro: boolean;
  planId: PlanId | null;
  planName: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'NONE';
  currentPeriodEnd: string | null;
  provider: PaymentProvider | null;
  /** True when the period has passed; the client shows a renew button. */
  expired: boolean;
  /** True when the learner stopped renewal but still has access to the period end. */
  cancelAtPeriodEnd: boolean;
}

export interface BillingOrder {
  id: string;
  planId: PlanId | null;
  planName: string;
  provider: PaymentProvider;
  status: OrderStatus;
  amountVnd: number;
  /** Bank transfer reference shown to the learner. */
  reference: string;
  createdAt: string;
  paidAt: string | null;
  /** Stripe Checkout URL while the order is pending, when available. */
  redirectUrl: string | null;
  /** Human instructions for a bank transfer. */
  instructions: string | null;
}

export interface BillingState {
  subscription: SubscriptionView;
  orders: BillingOrder[];
  /** Season shown on the pricing page so the league and the pass agree. */
  season: SeasonInfo;
  /** False when Stripe keys are absent; the UI hides the card option then. */
  cardAvailable: boolean;
  /** True in local preview, where the demo activation button is shown. */
  demoAvailable: boolean;
}

export interface AdminBillingOrder extends BillingOrder {
  userId: string;
  userEmail: string;
  userName: string;
}

export interface AdminBillingOrders {
  orders: AdminBillingOrder[];
  pending: number;
}

export interface CheckoutResult {
  order: BillingOrder;
  /** Send the browser here for Stripe Checkout. */
  redirectUrl: string | null;
}

export const NO_SUBSCRIPTION: SubscriptionView = {
  pro: false,
  planId: null,
  planName: null,
  status: 'NONE',
  currentPeriodEnd: null,
  provider: null,
  expired: false,
  cancelAtPeriodEnd: false,
};

/** Determine whether a subscription row is still inside its paid period. */
export function subscriptionIsActive(status: string | null, periodEnd: string | null, nowIso: string): boolean {
  if ((status !== 'ACTIVE' && status !== 'CANCELLED') || !periodEnd) return false;
  return Date.parse(periodEnd) > Date.parse(nowIso);
}
