/**
 * Plans and checkout.
 *
 * The page explains the free tier first, then sells Pro. Two payment paths are
 * offered when the deployment supports them: a Stripe card checkout and a bank
 * transfer whose pending order an administrator confirms. In preview a third,
 * clearly labelled demo button activates the plan immediately.
 *
 * A learner never leaves this page without knowing what happened: an order
 * shows its reference and instructions, a paid order shows the new period end,
 * and returning from Stripe polls the order until the webhook lands.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PLANS, formatVnd, type BillingOrder, type PaymentProvider, type Plan } from '@shared/billing';
import { seasonCountdown } from '@shared/season';
import { Icon } from '../../components/Icon';
import { Badge, Button, Card, EmptyState, Loading, Notice } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { billingApi } from '../../lib/billing-api';
import { learnApi } from '../../lib/learn-api';
import { describeError } from '../../lib/api';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  PAID: 'success',
  PENDING: 'warning',
  CANCELLED: 'neutral',
  EXPIRED: 'danger',
};

function OrderRow({ order, onChanged }: { order: BillingOrder; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="billing-order">
      <div className="billing-order__main">
        <div className="billing-order__top">
          <b>{order.planName}</b>
          <Badge tone={STATUS_TONE[order.status] ?? 'neutral'}>{order.status.toLowerCase()}</Badge>
          <span className="billing-order__amount">{formatVnd(order.amountVnd)}</span>
        </div>
        <p className="tiny muted">
          {order.provider === 'BANK' ? 'Bank transfer' : order.provider === 'CARD' ? 'Card' : 'Demo'} · reference{' '}
          <code>{order.reference}</code> · {new Date(order.createdAt).toLocaleDateString('en-GB')}
          {order.paidAt ? ` · paid ${new Date(order.paidAt).toLocaleDateString('en-GB')}` : ''}
        </p>
        {order.status === 'PENDING' && order.instructions ? <p className="small billing-order__instructions">{order.instructions}</p> : null}
        {error ? <p className="tiny" style={{ color: 'var(--danger)' }}>{error}</p> : null}
      </div>
      <div className="row">
        {order.status === 'PENDING' && order.redirectUrl ? (
          <a className="btn btn--sm btn--primary" href={order.redirectUrl}>
            Open Stripe
          </a>
        ) : null}
        {order.status === 'PENDING' ? (
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await billingApi.cancel(order.id);
                onChanged();
              } catch (cancelError) {
                setError(describeError(cancelError));
              } finally {
                setBusy(false);
              }
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function PricingPage() {
  const [params] = useSearchParams();
  const state = useAsync(() => billingApi.state(), []);
  const season = useAsync(() => learnApi.season(), []);
  const [provider, setProvider] = useState<PaymentProvider>('BANK');
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const data = state.data;
  const returning = params.get('status') === 'success';
  const cancelled = params.get('status') === 'cancelled';

  useEffect(() => {
    if (!returning) return;
    const timer = setTimeout(() => void state.reload(), 2500);
    return () => clearTimeout(timer);
  }, [returning, state.reload]);

  const checkout = async (plan: Plan, method: PaymentProvider) => {
    setBusyPlan(`${plan.id}:${method}`);
    setError(null);
    setNotice(null);
    try {
      const result = await billingApi.checkout(plan.id, method);
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
      setNotice(
        method === 'DEMO'
          ? `Demo ${plan.name} activated. Pro runs until ${result.order.paidAt ? new Date(result.order.paidAt).toLocaleDateString('en-GB') : 'the end of the period'}; the subscription card shows the exact end date.`
          : `Order ${result.order.reference} created. Transfer ${formatVnd(plan.priceVnd)} with that reference; an administrator confirms it, usually within one working day.`,
      );
      await state.reload();
    } catch (checkoutError) {
      setError(describeError(checkoutError));
    } finally {
      setBusyPlan(null);
    }
  };

  if (state.loading && !data) return <Loading label="Loading plans…" />;
  if (state.error && !data) {
    return (
      <Notice tone="danger" title="Plans could not be loaded">
        {state.error}
      </Notice>
    );
  }
  if (!data) return null;

  const cardAvailable = data.cardAvailable;
  const methods: Array<{ id: PaymentProvider; label: string; hint: string; disabled: boolean }> = [
    {
      id: 'CARD',
      label: 'Card (Stripe)',
      hint: cardAvailable ? 'Visa, Mastercard, JCB via Stripe Checkout.' : 'Card payments are not configured on this deployment.',
      disabled: !cardAvailable,
    },
    { id: 'BANK', label: 'Bank transfer', hint: 'Transfer with the order reference; an admin confirms it.', disabled: false },
    ...(data.demoAvailable
      ? [{ id: 'DEMO' as PaymentProvider, label: 'Demo activation', hint: 'Local preview only: activates Pro without a charge.', disabled: false }]
      : []),
  ];
  const selected = methods.find((method) => method.id === provider && !method.disabled) ?? methods.find((method) => !method.disabled)!;

  return (
    <div className="stack billing-page">
      <div className="page-head">
        <div>
          <p className="page-head__kicker">Plans</p>
          <h1>Free to practise. Pro when you are ready.</h1>
          <p className="page-head__meta">
            Every paper, lesson and drill stays available on the free plan. Pro adds unlimited AI speaking practice, the
            season pass and class leagues.
          </p>
        </div>
        {season.data ? <Badge tone="accent">{seasonCountdown(season.data.season)}</Badge> : null}
      </div>

      {returning ? (
        <Notice tone="info" title={data.subscription.pro ? 'Payment received' : 'Waiting for the payment confirmation'}>
          {data.subscription.pro
            ? `Pro is active until ${data.subscription.currentPeriodEnd?.slice(0, 10)}.`
            : 'Stripe has sent you back. The webhook usually lands within a minute — refresh this page if the plan has not changed.'}{' '}
          <Button size="sm" variant="ghost" onClick={() => void state.reload()}>
            <Icon name="rotate" size={13} /> Refresh
          </Button>
        </Notice>
      ) : null}
      {cancelled ? <Notice tone="warning" title="Checkout cancelled">No charge was made.</Notice> : null}

      {data.subscription.pro ? (
        <Card title="Your plan" hint="Access runs to the period end; cancelling stops the renewal, not the access.">
          <div className="billing-current">
            <div>
              <p className="billing-current__plan">{data.subscription.planName}</p>
              <p className="muted small">
                Active until <b>{data.subscription.currentPeriodEnd?.slice(0, 10)}</b>
                {data.subscription.provider ? ` · paid by ${data.subscription.provider.toLowerCase()}` : ''}
              </p>
            </div>
            <div className="row">
              <Badge tone="success">Pro</Badge>
              {data.subscription.cancelAtPeriodEnd ? (
                <Badge tone="neutral">Renewal stopped</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busyPlan === 'cancel-sub'}
                  onClick={async () => {
                    setBusyPlan('cancel-sub');
                    setError(null);
                    try {
                      await billingApi.cancelSubscription();
                      setNotice('Renewal stopped. Pro stays active until the period end.');
                      await state.reload();
                    } catch (cancelError) {
                      setError(describeError(cancelError));
                    } finally {
                      setBusyPlan(null);
                    }
                  }}
                >
                  Stop renewal
                </Button>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="billing-plans">
        {PLANS.map((plan) => (
          <section key={plan.id} className={`billing-plan${plan.featured ? ' is-featured' : ''}`}>
            <header>
              <div>
                <h2>{plan.name}</h2>
                <p className="muted small">{plan.blurb}</p>
              </div>
              {plan.featured ? <Badge tone="accent">Best value</Badge> : null}
            </header>
            <p className="billing-plan__price">
              {formatVnd(plan.priceVnd)}
              <span className="muted small"> / {plan.months === 1 ? 'month' : 'year'}</span>
            </p>
            {plan.months > 1 ? <p className="tiny muted">{formatVnd(plan.monthlyEquivalentVnd)} per month</p> : null}
            <ul className="billing-plan__perks">
              {plan.perks.map((perk) => (
                <li key={perk}>
                  <Icon name="check" size={13} /> {perk}
                </li>
              ))}
            </ul>
            <div className="billing-plan__actions">
              {methods.map((method) => (
                <Button
                  key={method.id}
                  block
                  variant={method.id === 'BANK' ? 'secondary' : 'primary'}
                  disabled={method.disabled || data.subscription.pro || busyPlan !== null}
                  loading={busyPlan === `${plan.id}:${method.id}`}
                  onClick={() => void checkout(plan, method.id)}
                >
                  {method.id === 'CARD' ? 'Pay by card' : method.id === 'BANK' ? 'Pay by bank transfer' : 'Activate demo Pro'}
                </Button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Card title="Payment method" hint="Card checkout needs Stripe keys; bank transfer works today.">
        <div className="billing-methods">
          {methods.map((method) => (
            <label key={method.id} className={`billing-method${selected.id === method.id ? ' is-on' : ''}${method.disabled ? ' is-disabled' : ''}`}>
              <input
                type="radio"
                name="provider"
                value={method.id}
                checked={selected.id === method.id}
                disabled={method.disabled}
                onChange={() => setProvider(method.id)}
              />
              <span>
                <b>{method.label}</b>
                <span className="tiny muted">{method.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}
      </Card>

      <Card title="Orders" hint="Every checkout is recorded with the amount that was charged.">
        {data.orders.length === 0 ? (
          <EmptyState title="No orders yet" icon="coin">
            Pick a plan above when you are ready. The free plan never expires.
          </EmptyState>
        ) : (
          <ul className="billing-orders">
            {data.orders.map((order) => (
              <OrderRow key={order.id} order={order} onChanged={() => void state.reload()} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="What stays free" hint="Pro should feel like acceleration, not a paywall on learning.">
        <ul className="billing-plan__perks">
          <li><Icon name="check" size={13} /> All published practice tests and full mocks</li>
          <li><Icon name="check" size={13} /> Lessons, reviews, dictionary and the AI tutor</li>
          <li><Icon name="check" size={13} /> Question-type drills, dictation lab, study rooms</li>
          <li><Icon name="check" size={13} /> Your history, band estimates and certificates</li>
        </ul>
        <p className="tiny muted">
          Manage a class or a mentor studio? <Link to="/classrooms">Classrooms</Link> and bookings keep the same prices.
        </p>
      </Card>
    </div>
  );
}
