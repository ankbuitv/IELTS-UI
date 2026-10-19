import type { AdminBillingOrders, BillingOrder, BillingState, CheckoutResult, PaymentProvider, SubscriptionView } from '@shared/billing';
import { api } from './api';

export const billingApi = {
  state: () => api.get<BillingState>('/api/billing'),
  checkout: (plan: string, provider: PaymentProvider) =>
    api.post<CheckoutResult>('/api/billing/checkout', { plan, provider }),
  cancel: (orderId: string) => api.post<{ order: BillingOrder }>(`/api/billing/orders/${encodeURIComponent(orderId)}/cancel`, {}),
  pro: () => api.get<{ pro: boolean; subscription: SubscriptionView }>('/api/billing/pro'),
  cancelSubscription: () =>
    api.post<{ subscription: SubscriptionView }>('/api/billing/subscription/cancel', {}),

  adminOrders: (status?: string) =>
    api.get<AdminBillingOrders>(`/api/admin/billing/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  adminApprove: (orderId: string) =>
    api.post<{ subscription: SubscriptionView }>(`/api/admin/billing/orders/${encodeURIComponent(orderId)}/approve`, {}),
};
