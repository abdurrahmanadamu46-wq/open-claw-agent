import api from '../api';

export type BillingPlanRow = {
  token_limit: number;
  run_limit: number;
  price_month_cny: number;
  price_year_cny: number;
};

export type BillingSubscription = {
  id: string;
  user_id: string;
  tenant_id: string;
  plan_code: string;
  cycle: string;
  status: string;
  payment_provider: string;
  token_limit: number;
  run_limit: number;
  used_tokens: number;
  used_runs: number;
  auto_renew: boolean;
  current_period_start: string;
  current_period_end: string;
};

export type BillingUsageSummary = {
  user_id: string;
  tenant_id: string;
  total_runs: number;
  total_tokens: number;
  total_cost_cny: number;
  window_from?: string;
  window_to?: string;
  by_event_type?: Record<string, { runs: number; tokens: number; cost_cny: number }>;
};

export type BillingOrder = {
  order_id: string;
  checkout_id: string;
  user_id: string;
  tenant_id: string;
  plan_code: string;
  cycle: string;
  payment_provider: string;
  amount_cny: number;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_error?: string | null;
};

export type BillingCompensationTask = {
  task_id: string;
  order_id: string;
  user_id: string;
  tenant_id: string;
  reason_code: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type BillingWebhookEvent = {
  provider: string;
  event_id: string;
  action: string;
  order_id?: string | null;
  processed_ok: boolean;
  duplicate: boolean;
  reason?: string | null;
  created_at: string;
};

export type SeatBillingTier = {
  min_seats: number;
  max_seats: number;
  unit_price: number;
  floor_price: number;
  pricing: Record<string, unknown>;
};

export type SeatSubscription = {
  id: string;
  tenant_id: string;
  agent_id?: string | null;
  seat_count: number;
  unit_price: number;
  floor_price: number;
  billing_cycle: string;
  status: string;
  monthly_amount: number;
  annual_amount: number;
  trial_ends_at?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  checkout_id?: string | null;
};

export type SeatQuotaSummary = {
  tenant_id: string;
  seat_count: number;
  overall_health: string;
  quotas: Record<string, { limit: number; used: number; usage_pct: number }>;
  seats: Array<{
    seat_id: string;
    seat_name: string;
    platform: string;
    account_username: string;
    client_name: string;
    overall_health: string;
    quotas: Record<string, { limit: number; used: number; usage_pct: number }>;
  }>;
};

export async function fetchBillingPlans() {
  const { data } = await api.get('/api/v1/ai/billing/plans');
  return data as {
    ok: boolean;
    plans: Record<string, BillingPlanRow>;
  };
}

export async function fetchBillingSubscription(userId?: string) {
  const { data } = await api.get('/api/v1/ai/billing/subscription', {
    params: userId ? { user_id: userId } : undefined,
  });
  return data as {
    ok: boolean;
    subscription: BillingSubscription;
  };
}

export async function fetchBillingUsageSummary(input?: { userId?: string; fromTs?: string; toTs?: string }) {
  const { data } = await api.get('/api/v1/ai/billing/usage-summary', {
    params: {
      ...(input?.userId ? { user_id: input.userId } : {}),
      ...(input?.fromTs ? { from_ts: input.fromTs } : {}),
      ...(input?.toTs ? { to_ts: input.toTs } : {}),
    },
  });
  return data as {
    ok: boolean;
    summary: BillingUsageSummary;
  };
}

export async function fetchBillingProvidersStatus() {
  const { data } = await api.get('/api/v1/ai/billing/providers-status');
  return data as {
    ok: boolean;
    providers: {
      default_provider: string;
      providers: Record<string, { enabled: boolean; ready: boolean }>;
    };
  };
}

export async function fetchBillingOrders(userId?: string) {
  const { data } = await api.get('/api/v1/ai/billing/orders', {
    params: userId ? { user_id: userId } : undefined,
  });
  return data as {
    ok: boolean;
    count: number;
    orders: BillingOrder[];
  };
}

export async function fetchBillingCompensation(status?: string) {
  const { data } = await api.get('/api/v1/ai/billing/compensation', {
    params: status ? { status } : undefined,
  });
  return data as {
    ok: boolean;
    count: number;
    items: BillingCompensationTask[];
  };
}

export async function fetchBillingWebhookEvents() {
  const { data } = await api.get('/api/v1/ai/billing/webhook/events');
  return data as {
    ok: boolean;
    count: number;
    items: BillingWebhookEvent[];
  };
}

export async function activateBillingTrial(input?: { planCode?: string; durationDays?: number }) {
  const { data } = await api.post('/api/v1/ai/billing/trial/activate', {
    plan_code: input?.planCode ?? 'pro',
    duration_days: input?.durationDays ?? 14,
  });
  return data as {
    ok: boolean;
    subscription: BillingSubscription;
  };
}

export async function createBillingCheckout(input: {
  planCode: string;
  cycle: string;
  provider?: string;
  returnUrl?: string;
}) {
  const { data } = await api.post('/api/v1/ai/billing/checkout', {
    plan_code: input.planCode,
    cycle: input.cycle,
    provider: input.provider,
    return_url: input.returnUrl,
  });
  return data as {
    ok: boolean;
    checkout: {
      checkout_id: string;
      order_id: string;
      checkout_url: string;
      status: string;
    };
    order: BillingOrder;
  };
}

export async function fetchSeatBillingPlans() {
  const { data } = await api.get('/api/v1/ai/billing/seats/plans');
  return data as { ok: boolean; tiers: SeatBillingTier[] };
}

export async function fetchSeatBillingSubscription() {
  const { data } = await api.get('/api/v1/ai/billing/seats/subscription');
  return data as { ok: boolean; subscription: SeatSubscription | null };
}

export async function createSeatBillingSubscription(input: {
  seatCount: number;
  billingCycle: 'monthly' | 'annual';
  agentId?: string;
  trialDays?: number;
}) {
  const { data } = await api.post('/api/v1/ai/billing/seats/subscription', {
    seat_count: input.seatCount,
    billing_cycle: input.billingCycle,
    agent_id: input.agentId,
    trial_days: input.trialDays ?? 14,
  });
  return data as { ok: boolean; subscription: SeatSubscription };
}

export async function createSeatBillingCheckout(subscriptionId: string, input?: { provider?: string; returnUrl?: string }) {
  const { data } = await api.post(`/api/v1/ai/billing/seats/subscription/${subscriptionId}/checkout`, {
    provider: input?.provider ?? 'wechatpay',
    return_url: input?.returnUrl,
  });
  return data as {
    ok: boolean;
    subscription: SeatSubscription;
    checkout: {
      checkout_id: string;
      checkout_url: string;
      order_id: string;
      status: string;
    };
  };
}

export async function upgradeSeatBillingSubscription(subscriptionId: string, seatCount: number) {
  const { data } = await api.post(`/api/v1/ai/billing/seats/subscription/${subscriptionId}/upgrade`, {
    new_seat_count: seatCount,
  });
  return data as { ok: boolean; subscription: SeatSubscription; proration_amount: number };
}

export async function fetchSeatQuotaSummary(tenantId: string) {
  const { data } = await api.get(`/api/v1/ai/billing/seats/quotas`, {
    params: { tenant_id: tenantId },
  });
  return data as { ok: boolean; summary: SeatQuotaSummary };
}

export async function fetchNotificationStatus() {
  const { data } = await api.get('/api/v1/ai/notifications/status');
  return data as {
    ok: boolean;
    notifications: {
      mode: string;
      file_outbox: string;
      smtp: {
        configured: boolean;
        host: string;
        from_email: string;
      };
      sms_mock_enabled: boolean;
      sms_webhook_configured: boolean;
    };
  };
}

export async function fetchNotificationOutbox(limit = 20) {
  const { data } = await api.get('/api/v1/ai/notifications/outbox', {
    params: { limit },
  });
  return data as {
    ok: boolean;
    count: number;
    items: Array<{
      file: string;
      kind: string;
      target: string;
      requested_at: string;
      channel: string;
    }>;
  };
}

export async function sendNotificationTest(target: string, text: string) {
  const { data } = await api.post('/api/v1/ai/notifications/test', {
    target,
    text,
  });
  return data as {
    ok: boolean;
    result: {
      ok: boolean;
      mode: string;
      kind: string;
      target: string;
      detail: Record<string, unknown>;
    };
  };
}

export async function fetchFeishuCallbackReadiness() {
  const { data } = await api.get('/api/v1/ai/integrations/feishu/callback-readiness');
  return data as {
    ok: boolean;
    ready: boolean;
    callback_url: string;
    checks: Record<string, boolean>;
    next_step: string;
  };
}
