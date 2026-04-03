import api from '../api';
import type {
  LobsterBudgetUsage,
  LobsterCostSummaryRow,
  LobsterCostTimeseriesPoint,
  LobsterCostTopCall,
} from '@/types/lobster-cost';

export async function fetchLobsterCostSummary(days: 1 | 7 | 30 = 7) {
  const { data } = await api.get('/api/v1/cost/lobsters', { params: { days } });
  return data as {
    ok: boolean;
    tenant_id: string;
    range: string;
    items: LobsterCostSummaryRow[];
    budget: LobsterBudgetUsage;
  };
}

export async function fetchLobsterCostDetail(lobsterId: string, days: 1 | 7 | 30 = 7) {
  const { data } = await api.get(`/api/v1/cost/lobsters/${encodeURIComponent(lobsterId)}`, {
    params: { days },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    range: string;
    summary: LobsterCostSummaryRow;
    top_calls: LobsterCostTopCall[];
  };
}

export async function fetchLobsterCostTimeseries(lobsterId: string, days: 1 | 7 | 30 = 7) {
  const { data } = await api.get(`/api/v1/cost/lobsters/${encodeURIComponent(lobsterId)}/timeseries`, {
    params: { days },
  });
  return data as {
    ok: boolean;
    tenant_id: string;
    lobster_id: string;
    range: string;
    data: LobsterCostTimeseriesPoint[];
  };
}
