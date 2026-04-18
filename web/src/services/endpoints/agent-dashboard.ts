export interface ScopeAlertFeedStats {
  queuedCount?: number;
  handledCount?: number;
  failedCount?: number;
  simulatedCount?: number;
}

export interface ScopeAlertFeedLatest {
  resultAt?: string | null;
  resultStatus?: string | null;
}

export interface ScopeAlertFeedItem {
  title: string;
  severity: string;
  alertType: string;
  recommendedAction: string;
  message: string;
  stats: ScopeAlertFeedStats;
  latest: ScopeAlertFeedLatest;
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

export async function fetchScopeAlertFeed(): Promise<ScopeAlertFeedResponse> {
  const response = await fetch('/api/agent/scope-alerts', {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch scope alerts: HTTP ${response.status}`);
  }

  return (await response.json()) as ScopeAlertFeedResponse;
}

export async function fetchScopeRolloutTrend(): Promise<ScopeRolloutTrendResponse> {
  const response = await fetch('/api/agent/scope-rollout-trend', {
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

export function resolveScopeAlertEventsUrl(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const explicit = process.env.NEXT_PUBLIC_AGENT_DASHBOARD_WS_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '') + '/api/agent/scope-alerts/events';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  return `${protocol}//${host}:38789/api/agent/scope-alerts/events`;
}
