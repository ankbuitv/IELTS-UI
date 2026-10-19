/**
 * Billing queue.
 *
 * Bank transfers arrive as PENDING orders. An administrator checks that the
 * reference on the transfer matches the order and confirms it here; the
 * subscription starts from the confirmation moment and the learner is notified.
 * Stripe orders need no action — the webhook marks them paid.
 */
import { useState } from 'react';
import { formatVnd, type AdminBillingOrders, type OrderStatus } from '@shared/billing';
import { Badge, Button, Card, Loading, Notice, Select, Stat } from '../../components/ui';
import { useAsync } from '../../hooks/useAsync';
import { billingApi } from '../../lib/billing-api';
import { describeError } from '../../lib/api';

const STATUS_OPTIONS: Array<{ value: '' | OrderStatus; label: string }> = [
  { value: '', label: 'All orders' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
];

export function AdminBillingPage() {
  const [status, setStatus] = useState<'' | OrderStatus>('PENDING');
  const orders = useAsync<AdminBillingOrders>(() => billingApi.adminOrders(status || undefined), [status]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const approve = async (orderId: string) => {
    setBusy(orderId);
    setError(null);
    setNotice(null);
    try {
      const result = await billingApi.adminApprove(orderId);
      setNotice(`Order confirmed. Access now runs to ${result.subscription.currentPeriodEnd?.slice(0, 10)}.`);
      await orders.reload();
    } catch (approveError) {
      setError(describeError(approveError));
    } finally {
      setBusy(null);
    }
  };

  const data = orders.data;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="page-head__kicker">Billing</p>
          <h1>Orders and transfers</h1>
          <p className="page-head__meta">
            Confirm a bank transfer only when the reference and the amount both match. Confirming twice is safe; the
            second call is a no-op.
          </p>
        </div>
        <label className="field">
          <span className="field__label">Status</span>
          <Select value={status} onChange={(event) => setStatus(event.target.value as '' | OrderStatus)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </label>
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {data ? (
        <div className="stat-row">
          <Stat label="Pending transfers" value={data.pending} accent="amber" />
          <Stat label="Orders shown" value={data.orders.length} accent="brand" />
        </div>
      ) : null}

      <Card title="Orders" hint="Card orders are completed by the Stripe webhook; bank orders need a human.">
        {orders.loading && !data ? <Loading /> : null}
        {!data ? null : data.orders.length === 0 ? (
          <p className="muted">No orders match this filter.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Learner</th>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>Provider</th>
                  <th>Reference</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <b>{order.userName}</b>
                      <div className="tiny muted">{order.userEmail}</div>
                    </td>
                    <td>{order.planName}</td>
                    <td>{formatVnd(order.amountVnd)}</td>
                    <td>{order.provider}</td>
                    <td><code className="tiny">{order.reference}</code></td>
                    <td className="tiny">{new Date(order.createdAt).toLocaleString('en-GB')}</td>
                    <td>
                      <Badge tone={order.status === 'PAID' ? 'success' : order.status === 'PENDING' ? 'warning' : 'neutral'}>
                        {order.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td>
                      {order.status === 'PENDING' ? (
                        <Button size="sm" variant="primary" loading={busy === order.id} onClick={() => void approve(order.id)}>
                          Confirm paid
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Setup" hint="Card checkout activates only when the deployment has Stripe keys.">
        <ul className="billing-plan__perks">
          <li><code>STRIPE_SECRET_KEY</code> enables the card option and Stripe Checkout.</li>
          <li><code>STRIPE_WEBHOOK_SECRET</code> is required for <code>/api/billing/stripe/webhook</code>; the endpoint refuses unsigned events.</li>
          <li><code>BILLING_BANK_NAME</code>, <code>BILLING_BANK_ACCOUNT</code> and <code>BILLING_BANK_HOLDER</code> fill the transfer instructions.</li>
          <li>The webhook needs <code>checkout.session.completed</code> (or <code>async_payment_succeeded</code>) with the order id in <code>client_reference_id</code>.</li>
        </ul>
      </Card>
    </div>
  );
}
