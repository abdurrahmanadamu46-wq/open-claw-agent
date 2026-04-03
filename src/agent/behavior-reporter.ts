/**
 * 行为日志上报 — 边缘执行完成后上报到云端，进入评分闭环
 * 上报后云端会：打分 → 入经验池 → 供 Behavior Engine 进化
 */

export interface BehaviorLogPayload {
  persona_id: string;
  session_id: string;
  tenant_id?: string;
  node_id?: string;
  trace_id?: string;
  path: { session_id: string; steps: Array<{ action: string; delay?: number; duration?: number; target?: string; content?: string }> };
  step_delays_sec?: number[];
  duration_sec: number;
  effectiveness: { likes?: number; comments?: number; shares?: number; leads?: number };
  node_health?: { cpu_percent?: number; memory_percent?: number; latency_ms?: number; duration_sec?: number };
  risk_flags?: { repeated_pattern?: boolean; too_fast?: boolean; sync_with_others?: boolean; anomaly_probability?: number };
}

export interface BehaviorLogReportResult {
  score: {
    effectiveness_score: number;
    human_score: number;
    risk_score: number;
    efficiency_score: number;
    total_score: number;
    at: string;
  };
}

/**
 * 上报单条行为日志到云端评分系统
 * @param baseUrl 后端根地址，如 http://localhost:3000
 * @param payload 行为日志
 * @param headers 可选 headers（如 Authorization）
 */
export async function reportBehaviorLog(
  baseUrl: string,
  payload: BehaviorLogPayload,
  headers?: Record<string, string>,
): Promise<BehaviorLogReportResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/behavior/log`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      ...payload,
      created_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    throw new Error(`reportBehaviorLog failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
