const DEFAULT_AGENT_DASHBOARD_BASE_URL = 'http://127.0.0.1:38789';

export interface ScopeAlertFeedItem {
  title: string;
  severity: string;
  alertType: string;
  recommendedAction: string;
  message: string;
  stats: Record<string, unknown>;
  latest: Record<string, unknown>;
  generatedAt: string;
  sourcePath: string;
}

export interface ScopeAlertFeedResponse {
  items: ScopeAlertFeedItem[];
  total: number;
  at: string;
}

export interface ScopeRolloutTrendBucket {
  bucketStart: string;
  queuedCount: number;
  handledCount: number;
  failedCount: number;
  simulatedCount: number;
}

export interface ScopeRolloutTrendItem {
  roleId: string;
  scopeId: string;
  recommendedAction: string;
  recommendedLiveWeight: number;
  totalQueuedCount: number;
  totalHandledCount: number;
  totalFailedCount: number;
  totalSimulatedCount: number;
  latestQueueAt: string | null;
  latestResultAt: string | null;
  latestResultStatus: string | null;
  latestResultNote: string | null;
  bridgeTargets: string[];
  buckets: ScopeRolloutTrendBucket[];
}

export interface ScopeRolloutTrendResponse {
  trendVersion: string;
  generatedAt: string;
  routingPatchVersion: string | null;
  policyVersion: string | null;
  summary: {
    scopedEntryCount: number;
    queuedScopeCount: number;
    handledScopeCount: number;
    failedScopeCount: number;
    simulatedScopeCount: number;
  };
  scopes: ScopeRolloutTrendItem[];
}

function resolveAgentDashboardBaseUrl(): string {
  return (
    process.env.AGENT_DASHBOARD_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_AGENT_DASHBOARD_BASE_URL?.trim() ||
    DEFAULT_AGENT_DASHBOARD_BASE_URL
  );
}

export async function fetchScopeAlertFeedServer(): Promise<ScopeAlertFeedResponse> {
  const baseUrl = resolveAgentDashboardBaseUrl().replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/agent/scope-alerts`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch scope alert feed: HTTP ${response.status}`);
  }

  return (await response.json()) as ScopeAlertFeedResponse;
}

export async function fetchScopeRolloutTrendServer(): Promise<ScopeRolloutTrendResponse> {
  const baseUrl = resolveAgentDashboardBaseUrl().replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/agent/scope-rollout-trend`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch scope rollout trend: HTTP ${response.status}`);
  }

  return (await response.json()) as ScopeRolloutTrendResponse;
}
