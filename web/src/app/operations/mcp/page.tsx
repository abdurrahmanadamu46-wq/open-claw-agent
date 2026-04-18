'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plug, RefreshCw, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  createMcpServer,
  deleteMcpServer,
  fetchMcpCallHistory,
  fetchMcpMonitorFailures,
  fetchMcpMonitorHeatmap,
  fetchMcpMonitorTop,
  fetchMcpPolicies,
  fetchMcpServers,
  fetchMcpTools,
  fetchToolMarketplace,
  fetchToolSubscriptions,
  pingMcpServer,
  subscribeTool,
  unsubscribeTool,
  updateMcpServer
} from '@/services/endpoints/ai-subservice';
import type {
  MCPCallRecord,
  MCPServer,
  MCPTool,
  MCPToolMonitorFailureItem,
  MCPToolMonitorHeatmapItem,
  MCPToolMonitorTopItem,
  MCPToolPolicy,
  ToolMarketplaceListing,
  ToolMarketplaceSubscription,
} from '@/types/mcp-gateway';

const BORDER = 'rgba(71,85,105,0.42)';

function normalizeError(error: unknown, fallback: string): string {
  const maybe = error as { response?: { data?: { message?: string; detail?: string } }; message?: string };
  return maybe?.response?.data?.message || maybe?.response?.data?.detail || maybe?.message || fallback;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const dt = new Date(value);
  return Number.isNaN(dt.getTime())
    ? value
    : dt.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function MCPPage() {
  const t = useTranslations('operations.mcp');
  const common = useTranslations('common');
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [history, setHistory] = useState<MCPCallRecord[]>([]);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [topTools, setTopTools] = useState<MCPToolMonitorTopItem[]>([]);
  const [failureRows, setFailureRows] = useState<MCPToolMonitorFailureItem[]>([]);
  const [heatmapRows, setHeatmapRows] = useState<MCPToolMonitorHeatmapItem[]>([]);
  const [policies, setPolicies] = useState<MCPToolPolicy[]>([]);
  const [marketplace, setMarketplace] = useState<ToolMarketplaceListing[]>([]);
  const [subscriptions, setSubscriptions] = useState<ToolMarketplaceSubscription[]>([]);
  const [notice, setNotice] = useState('');
  const [errorText, setErrorText] = useState('');
  const [busy, setBusy] = useState(false);

  const [serverId, setServerId] = useState('');
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'sse' | 'edge'>('stdio');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [edgeNodeId, setEdgeNodeId] = useState('');
  const [envJson, setEnvJson] = useState('{}');

  const summary = useMemo(
    () => ({
      total: servers.length,
      healthy: servers.filter((item) => item.status === 'healthy').length,
      enabled: servers.filter((item) => item.enabled).length
    }),
    [servers]
  );

  const loadAll = async () => {
    const [serverData, historyData, topData, failureData, heatmapData, policyData, marketData, subData] = await Promise.all([
      fetchMcpServers(),
      fetchMcpCallHistory(50),
      fetchMcpMonitorTop(10),
      fetchMcpMonitorFailures(),
      fetchMcpMonitorHeatmap(),
      fetchMcpPolicies(),
      fetchToolMarketplace(),
      fetchToolSubscriptions(),
    ]);
    setServers(serverData.servers || []);
    setHistory(historyData.items || []);
    setTopTools(topData.items || []);
    setFailureRows(failureData.items || []);
    setHeatmapRows(heatmapData.items || []);
    setPolicies(policyData.items || []);
    setMarketplace(marketData.items || []);
    setSubscriptions(subData.items || []);
  };

  const loadTools = async (nextServerId: string) => {
    const data = await fetchMcpTools(nextServerId);
    setTools(data.tools || []);
  };

  useEffect(() => {
    void loadAll().catch((error) => setErrorText(normalizeError(error, t('messages.requestFailed'))));
  }, [t]);

  useEffect(() => {
    if (!selectedServerId) {
      setTools([]);
      return;
    }
    void loadTools(selectedServerId).catch((error) => setErrorText(normalizeError(error, t('messages.requestFailed'))));
  }, [selectedServerId, t]);

  const handleCreate = async () => {
    setBusy(true);
    setErrorText('');
    try {
      const env = JSON.parse(envJson || '{}') as Record<string, string>;
      await createMcpServer({
        id: serverId.trim(),
        name: name.trim(),
        transport,
        command: transport === 'stdio' ? command.trim() : undefined,
        url: transport === 'sse' ? url.trim() : undefined,
        env,
        enabled: true
        ,
        edge_node_id: transport === 'edge' ? edgeNodeId.trim() : undefined,
      });
      setNotice(t('messages.registerSuccess', { name: name || serverId }));
      setServerId('');
      setName('');
      setCommand('');
      setUrl('');
      setEdgeNodeId('');
      setEnvJson('{}');
      await loadAll();
    } catch (error) {
      setErrorText(normalizeError(error, t('messages.requestFailed')));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (server: MCPServer) => {
    try {
      await updateMcpServer(server.id, { enabled: !server.enabled });
      setNotice(t(server.enabled ? 'messages.toggleDisabled' : 'messages.toggleEnabled', { name: server.name }));
      await loadAll();
    } catch (error) {
      setErrorText(normalizeError(error, t('messages.requestFailed')));
    }
  };

  const handleDelete = async (server: MCPServer) => {
    try {
      await deleteMcpServer(server.id);
      setNotice(t('messages.deleteSuccess', { name: server.name }));
      if (selectedServerId === server.id) {
        setSelectedServerId('');
      }
      await loadAll();
    } catch (error) {
      setErrorText(normalizeError(error, t('messages.requestFailed')));
    }
  };

  const handlePing = async (server: MCPServer) => {
    try {
      const result = await pingMcpServer(server.id);
      setNotice(t(result.healthy ? 'messages.pingHealthy' : 'messages.pingUnavailable', { name: server.name }));
      await loadAll();
      if (selectedServerId === server.id) {
        await loadTools(server.id);
      }
    } catch (error) {
      setErrorText(normalizeError(error, t('messages.requestFailed')));
    }
  };

  const handleSubscribe = async (toolId: string, subscribed: boolean) => {
    try {
      if (subscribed) {
        await unsubscribeTool(toolId);
        setNotice(`已取消订阅 ${toolId}`);
      } else {
        await subscribeTool(toolId);
        setNotice(`已订阅 ${toolId}`);
      }
      await loadAll();
    } catch (error) {
      setErrorText(normalizeError(error, t('messages.requestFailed')));
    }
  };

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
        <section className="rounded-[28px] border p-5" style={{ background: 'linear-gradient(180deg, rgba(19,34,56,0.98), rgba(12,22,37,0.98))', borderColor: BORDER }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-cyan-300">{t('badge')}</div>
              <h1 className="mt-2 text-2xl font-semibold text-white">{t('title')}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-300">{t('description')}</p>
            </div>
            <button
              type="button"
              onClick={() => void loadAll().catch((error) => setErrorText(normalizeError(error, t('messages.requestFailed'))))}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600/80 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
            >
              <RefreshCw size={14} />
              {common('refresh')}
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label={t('metrics.total')} value={String(summary.total)} />
            <Metric label={t('metrics.healthy')} value={String(summary.healthy)} />
            <Metric label={t('metrics.enabled')} value={String(summary.enabled)} />
          </div>

          <div className="mt-5 space-y-3">
            <Field label={t('form.serverId')}>
              <input value={serverId} onChange={(e) => setServerId(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100" placeholder="mcp-search" />
            </Field>
            <Field label={t('form.name')}>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100" placeholder="MCP Search" />
            </Field>
            <Field label={t('form.transport')}>
              <select value={transport} onChange={(e) => setTransport(e.target.value as 'stdio' | 'sse' | 'edge')} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
                <option value="edge">edge</option>
              </select>
            </Field>
            {transport === 'stdio' ? (
              <Field label={t('form.command')}>
                <input value={command} onChange={(e) => setCommand(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100" placeholder="python server.py" />
              </Field>
            ) : transport === 'sse' ? (
              <Field label={t('form.url')}>
                <input value={url} onChange={(e) => setUrl(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100" placeholder="http://127.0.0.1:9000/mcp" />
              </Field>
            ) : (
              <Field label="Edge Node ID">
                <input value={edgeNodeId} onChange={(e) => setEdgeNodeId(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100" placeholder="node-001" />
              </Field>
            )}
            <Field label={t('form.env')}>
              <textarea value={envJson} onChange={(e) => setEnvJson(e.target.value)} rows={6} className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-100" />
            </Field>

            {notice ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{notice}</div> : null}
            {errorText ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{errorText}</div> : null}

            <button type="button" onClick={() => void handleCreate()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60">
              <Plug size={15} />
              {busy ? t('form.submitting') : t('form.submit')}
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="space-y-3">
              {servers.map((server) => (
                <article key={server.id} className="rounded-[24px] border border-slate-700 bg-[#1c2940] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{server.name}</div>
                      <div className="mt-1 text-xs text-slate-400">{server.id} · {server.transport}</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs ${server.status === 'healthy' ? 'bg-emerald-500/15 text-emerald-200' : server.status === 'unavailable' ? 'bg-rose-500/15 text-rose-200' : 'bg-white/10 text-slate-300'}`}>
                      {server.status}
                    </span>
                  </div>

                  <div className="mt-3 text-xs text-slate-400">Last Ping: {formatDateTime(server.last_ping)}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setSelectedServerId(server.id)} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800/70">
                      <Wrench size={14} />
                      {t('serverActions.tools')}
                    </button>
                    <button type="button" onClick={() => void handlePing(server)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/10">
                      <ShieldCheck size={14} />
                      {t('serverActions.ping')}
                    </button>
                    <button type="button" onClick={() => void handleToggle(server)} className="rounded-xl border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800/70">
                      {server.enabled ? common('disable') : common('enable')}
                    </button>
                    <button type="button" onClick={() => void handleDelete(server)} className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/10">
                      <Trash2 size={14} />
                      {t('serverActions.delete')}
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="rounded-[24px] border border-slate-700 bg-[#1c2940] p-4">
              <div className="text-sm font-semibold text-white">{t('sections.tools')}</div>
              <div className="mt-1 text-xs text-slate-400">{selectedServerId || t('sections.selectHint')}</div>
              <div className="mt-4 space-y-3">
                {tools.map((tool) => (
                  <div key={`${tool.server_id}-${tool.tool_name}`} className="rounded-xl border border-slate-700/70 bg-slate-950/40 p-3">
                    <div className="text-sm font-medium text-white">{tool.tool_name}</div>
                    <div className="mt-1 text-xs text-slate-400">{tool.description || t('sections.noDescription')}</div>
                    <pre className="mt-3 overflow-x-auto rounded-lg bg-black/30 p-3 text-xs text-cyan-100">{JSON.stringify(tool.input_schema, null, 2)}</pre>
                  </div>
                ))}
                {!tools.length ? <div className="text-sm text-slate-400">{t('sections.emptyTools')}</div> : null}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-700 bg-[#1c2940] p-4">
            <div className="text-sm font-semibold text-white">{t('sections.history')}</div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('table.time')}</th>
                    <th className="px-3 py-2 text-left">{t('table.lobster')}</th>
                    <th className="px-3 py-2 text-left">{t('table.server')}</th>
                    <th className="px-3 py-2 text-left">{t('table.tool')}</th>
                    <th className="px-3 py-2 text-left">{t('table.duration')}</th>
                    <th className="px-3 py-2 text-left">{t('table.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id} className="border-t border-slate-800 text-slate-200">
                      <td className="px-3 py-2">{formatDateTime(item.created_at)}</td>
                      <td className="px-3 py-2">{item.lobster_id}</td>
                      <td className="px-3 py-2">{item.server_id}</td>
                      <td className="px-3 py-2">{item.tool_name}</td>
                      <td className="px-3 py-2">{item.duration_ms} ms</td>
                      <td className="px-3 py-2">{item.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
            <div className="rounded-[24px] border border-slate-700 bg-[#1c2940] p-4">
              <div className="text-sm font-semibold text-white">工具调用 Top</div>
              <div className="mt-3 space-y-2">
                {topTools.map((item) => (
                  <div key={item.tool} className="flex items-center justify-between rounded-xl border border-slate-700/70 bg-slate-950/40 px-3 py-2 text-sm">
                    <span>{item.tool}</span>
                    <span className="text-cyan-200">{item.count}</span>
                  </div>
                ))}
                {!topTools.length ? <div className="text-sm text-slate-400">暂无调用数据</div> : null}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-700 bg-[#1c2940] p-4">
              <div className="text-sm font-semibold text-white">失败率排行</div>
              <div className="mt-3 space-y-2">
                {failureRows.slice(0, 8).map((item) => (
                  <div key={`${item.lobster}-${item.tool}`} className="rounded-xl border border-slate-700/70 bg-slate-950/40 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>{item.lobster} / {item.tool}</span>
                      <span className={item.failure_rate_pct >= 20 ? 'text-rose-200' : 'text-slate-300'}>{item.failure_rate_pct}%</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">avg {item.avg_latency_ms}ms · denied {item.denied}</div>
                  </div>
                ))}
                {!failureRows.length ? <div className="text-sm text-slate-400">暂无失败统计</div> : null}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-700 bg-[#1c2940] p-4">
              <div className="text-sm font-semibold text-white">策略摘要</div>
              <div className="mt-3 space-y-2">
                {policies.slice(0, 8).map((policy) => (
                  <div key={policy.lobster_name} className="rounded-xl border border-slate-700/70 bg-slate-950/40 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>{policy.lobster_name}</span>
                      <span className="text-slate-300">{policy.allow_unknown_tools ? '宽松' : '最小权限'}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      allow {policy.allowed_tools.length} · deny {policy.denied_tools.length} · limits {Object.keys(policy.limits || {}).length}
                    </div>
                  </div>
                ))}
                {!policies.length ? <div className="text-sm text-slate-400">暂无策略数据</div> : null}
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-700 bg-[#1c2940] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">工具市场</div>
                <div className="mt-1 text-xs text-slate-400">免费内置工具默认可用，付费或扩展工具需要租户订阅。</div>
              </div>
              <div className="text-xs text-slate-400">已订阅 {subscriptions.length}</div>
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-[1.3fr_0.7fr]">
              <div className="grid gap-3 md:grid-cols-2">
                {marketplace.map((item) => (
                  <div key={item.tool_id} className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg">{item.icon || '🧩'}</div>
                        <div className="mt-2 text-sm font-semibold text-white">{item.name}</div>
                        <div className="mt-1 text-xs text-slate-400">{item.tool_id} · {item.category}</div>
                      </div>
                      <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-slate-300">
                        ${item.monthly_cost_usd.toFixed(2)}/mo
                      </span>
                    </div>
                    <div className="mt-3 text-xs leading-6 text-slate-300">{item.description}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(item.tags || []).slice(0, 4).map((tag) => (
                        <span key={tag} className="rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-400">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-500">{item.version}</span>
                      <button
                        type="button"
                        onClick={() => void handleSubscribe(item.tool_id, Boolean(item.subscribed))}
                        className={`rounded-xl px-3 py-1.5 text-sm ${item.subscribed ? 'border border-rose-500/40 text-rose-200 hover:bg-rose-500/10' : 'border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10'}`}
                      >
                        {item.subscribed ? '取消订阅' : '订阅'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">龙虾 × 工具热力</div>
                <div className="mt-3 space-y-2">
                  {heatmapRows.slice(0, 12).map((item) => (
                    <div key={`${item.lobster}-${item.tool}`} className="flex items-center justify-between rounded-xl border border-slate-700/60 px-3 py-2 text-sm">
                      <span>{item.lobster} / {item.tool}</span>
                      <span className="text-cyan-200">{item.count}</span>
                    </div>
                  ))}
                  {!heatmapRows.length ? <div className="text-sm text-slate-400">暂无热力数据</div> : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm text-slate-200">
      <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}
