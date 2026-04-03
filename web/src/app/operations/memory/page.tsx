'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Brain, Database, Filter, Layers3, RefreshCw } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import {
  fetchVectorBackupHistory,
  fetchVectorBackupSnapshots,
  fetchMemoryCompressionStats,
  fetchMemoryReports,
  fetchMemoryStats,
  fetchMemoryWisdoms,
  hybridMemorySearch,
  triggerMemoryCompression,
  triggerVectorBackup,
  type MemoryL1Report,
  type MemoryL2Wisdom,
} from '@/services/endpoints/ai-subservice';
import type { HybridMemorySearchItem } from '@/types/hybrid-memory-search';
import type { VectorBackupHistoryItem, VectorBackupSnapshot } from '@/types/vector-snapshot-backup';

const BORDER = 'rgba(71,85,105,0.42)';
const CARD_BG = '#132138';
const PANEL_BG = '#1a2942';

const LOBSTER_OPTIONS = [
  { id: '', label: '全部龙虾' },
  { id: 'radar', label: '触须虾' },
  { id: 'strategist', label: '脑虫虾' },
  { id: 'inkwriter', label: '吐墨虾' },
  { id: 'visualizer', label: '幻影虾' },
  { id: 'dispatcher', label: '点兵虾' },
  { id: 'echoer', label: '回声虾' },
  { id: 'catcher', label: '铁网虾' },
  { id: 'abacus', label: '金算虾' },
  { id: 'followup', label: '回访虾' },
];

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function normalizeAxiosError(error: unknown): string {
  const maybe = error as { response?: { status?: number; data?: { message?: string; detail?: string } }; message?: string };
  const status = maybe?.response?.status;
  const detail = maybe?.response?.data?.message || maybe?.response?.data?.detail;
  if (status && detail) return `请求失败 (${status}): ${detail}`;
  if (status) return `请求失败 (${status})`;
  return maybe?.message || '请求失败';
}

export default function MemoryPage() {
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';
  const [wisdoms, setWisdoms] = useState<MemoryL2Wisdom[]>([]);
  const [reports, setReports] = useState<MemoryL1Report[]>([]);
  const [stats, setStats] = useState<{
    layers: { l0: { count: number; bytes: number }; l1: { count: number; bytes: number }; l2: { count: number; bytes: number } };
    compression: { avg_l0_to_l1_ratio: number; avg_reports_per_wisdom: number };
    categories: Record<string, number>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [notice, setNotice] = useState('');
  const [lobsterFilter, setLobsterFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [compressionStats, setCompressionStats] = useState<{
    lobster_id: string;
    l0_count: number;
    l1_count: number;
    l2_count: number;
    compression_ratio: number;
  } | null>(null);
  const [hybridQuery, setHybridQuery] = useState('');
  const [hybridResults, setHybridResults] = useState<HybridMemorySearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [vectorHistory, setVectorHistory] = useState<VectorBackupHistoryItem[]>([]);
  const [selectedCollection, setSelectedCollection] = useState('lobster_episodic_memory');
  const [vectorSnapshots, setVectorSnapshots] = useState<VectorBackupSnapshot[]>([]);
  const [triggeringBackup, setTriggeringBackup] = useState(false);

  const load = async () => {
    setLoading(true);
    setErrorText('');
    try {
      const [statsResp, wisdomResp, reportResp] = await Promise.all([
        fetchMemoryStats(tenantId),
        fetchMemoryWisdoms({
          tenant_id: tenantId,
          lobster_id: lobsterFilter || undefined,
          category: categoryFilter || undefined,
          limit: 100,
        }),
        fetchMemoryReports({
          tenant_id: tenantId,
          lobster_id: lobsterFilter || undefined,
          limit: 100,
        }),
      ]);
      setStats(statsResp.stats);
      setWisdoms(wisdomResp.wisdoms || []);
      setReports(reportResp.reports || []);
      if (lobsterFilter) {
        try {
          const compressionResp = await fetchMemoryCompressionStats(lobsterFilter, tenantId);
          setCompressionStats(compressionResp.stats);
        } catch {
          setCompressionStats(null);
        }
      } else {
        setCompressionStats(null);
      }
      try {
        const [historyResp, snapshotResp] = await Promise.all([
          fetchVectorBackupHistory({ limit: 20 }),
          fetchVectorBackupSnapshots(selectedCollection),
        ]);
        setVectorHistory(historyResp.items || []);
        setVectorSnapshots(snapshotResp.snapshots || []);
      } catch {
        setVectorHistory([]);
        setVectorSnapshots([]);
      }
      setNotice(`已同步租户 ${tenantId} 的分层记忆。`);
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, lobsterFilter, categoryFilter]);

  const categoryOptions = useMemo(() => {
    const categories = new Set<string>(Object.keys(stats?.categories || {}));
    wisdoms.forEach((item) => categories.add(item.category));
    return ['', ...Array.from(categories).sort()];
  }, [stats?.categories, wisdoms]);

  const runCompression = async () => {
    setCompressing(true);
    setErrorText('');
    try {
      const result = await triggerMemoryCompression({
        tenant_id: tenantId,
        lobster_id: lobsterFilter || undefined,
        mode: lobsterFilter ? 'full' : 'l0_to_l1',
      });
      setNotice(result.summary || `已触发 ${lobsterFilter || '全局'} 记忆压缩任务。`);
      await load();
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setCompressing(false);
    }
  };

  const runHybridSearch = async () => {
    if (!hybridQuery.trim()) return;
    setSearching(true);
    setErrorText('');
    try {
      const result = await hybridMemorySearch({
        tenant_id: tenantId,
        node_id: lobsterFilter || undefined,
        lobster_name: lobsterFilter || undefined,
        query: hybridQuery.trim(),
        memory_type: categoryFilter || undefined,
        top_k: 8,
      });
      setHybridResults(result.items || []);
      setNotice(`已完成混合检索，命中 ${result.items.length} 条结果（${result.backend}）。`);
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setSearching(false);
    }
  };

  const runVectorBackup = async () => {
    setTriggeringBackup(true);
    setErrorText('');
    try {
      const result = await triggerVectorBackup([selectedCollection]);
      setNotice(`已触发向量快照备份：${Object.keys(result.collections || {}).join(', ') || selectedCollection}`);
      const [historyResp, snapshotResp] = await Promise.all([
        fetchVectorBackupHistory({ limit: 20 }),
        fetchVectorBackupSnapshots(selectedCollection),
      ]);
      setVectorHistory(historyResp.items || []);
      setVectorSnapshots(snapshotResp.snapshots || []);
    } catch (error) {
      setErrorText(normalizeAxiosError(error));
    } finally {
      setTriggeringBackup(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#07111f] p-6 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-5">
        <section
          className="rounded-[30px] border p-6"
          style={{ background: 'linear-gradient(135deg, rgba(18,34,57,0.98), rgba(11,21,36,0.98))', borderColor: BORDER }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">Memory</div>
              <h1 className="mt-3 text-3xl font-semibold text-white">知识三层压缩面板</h1>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                L0 保留原始任务对话，L1 抽成结构化工作报告，L2 再沉淀成可复用知识。这里看的不是聊天记录，而是“龙虾越做越会做”的证据。
              </p>
            </div>

            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-600/80 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
            >
              <RefreshCw size={15} />
              {loading ? '同步中...' : '刷新'}
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <MetricCard
              icon={<Database className="h-4 w-4" />}
              label="L0 原始层"
              value={String(stats?.layers.l0.count || 0)}
              helper={formatBytes(stats?.layers.l0.bytes || 0)}
            />
            <MetricCard
              icon={<Layers3 className="h-4 w-4" />}
              label="L1 报告层"
              value={String(stats?.layers.l1.count || 0)}
              helper={`${formatBytes(stats?.layers.l1.bytes || 0)} · ${stats?.compression.avg_l0_to_l1_ratio || 0}x`}
            />
            <MetricCard
              icon={<Brain className="h-4 w-4" />}
              label="L2 智慧层"
              value={String(stats?.layers.l2.count || 0)}
              helper={`${formatBytes(stats?.layers.l2.bytes || 0)} · ${stats?.compression.avg_reports_per_wisdom || 0} 报告/知识`}
            />
            <MetricCard
              icon={<Filter className="h-4 w-4" />}
              label="分类数"
              value={String(Object.keys(stats?.categories || {}).length)}
              helper="customer/channel/content/cost"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void runCompression()}
              disabled={compressing}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
            >
              <Layers3 className="h-4 w-4" />
              {compressing ? '压缩中...' : '触发压缩'}
            </button>
            {compressionStats ? (
              <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-2 text-sm text-slate-300">
                当前过滤龙虾 {compressionStats.lobster_id} · L0 {compressionStats.l0_count} / L1 {compressionStats.l1_count} / L2 {compressionStats.l2_count} · 压缩比 {compressionStats.compression_ratio.toFixed(2)}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-2 text-sm text-slate-400">
                选中单只龙虾后，这里会显示该角色的三层压缩统计。
              </div>
            )}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[220px_220px_minmax(0,1fr)]">
            <select
              value={lobsterFilter}
              onChange={(event) => setLobsterFilter(event.target.value)}
              className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
            >
              {LOBSTER_OPTIONS.map((option) => (
                <option key={option.id || 'all'} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
            >
              {categoryOptions.map((option) => (
                <option key={option || 'all'} value={option}>
                  {option || '全部分类'}
                </option>
              ))}
            </select>
            <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-2 text-sm text-slate-300">
              {notice || '选择龙虾/分类后，会同时筛掉 L1 报告和 L2 知识。'}
            </div>
          </div>

          {errorText ? (
            <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {errorText}
            </div>
          ) : null}
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div
            className="rounded-[28px] border p-5"
            style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-cyan-300">L2 Wisdom</div>
                <div className="mt-2 text-xl font-semibold text-white">抽象复用知识</div>
              </div>
              <div className="text-sm text-slate-400">{wisdoms.length} 条</div>
            </div>

            <div className="mt-4 space-y-3">
              {wisdoms.map((wisdom) => (
                <div
                  key={wisdom.wisdom_id}
                  className="rounded-2xl border border-slate-700/70 bg-slate-950/45 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">
                      {wisdom.category}
                    </span>
                    <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">
                      置信度 {(wisdom.confidence * 100).toFixed(0)}%
                    </span>
                    <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
                      merge x{wisdom.merge_count}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-slate-100">{wisdom.statement}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                    <span>来源龙虾: {wisdom.lobster_ids.join(', ') || '-'}</span>
                    <span>来源报告: {wisdom.source_reports.length}</span>
                    <span>更新: {formatDateTime(wisdom.updated_at)}</span>
                  </div>
                </div>
              ))}

              {!wisdoms.length ? (
                <EmptyCard
                  title="还没有 L2 智慧"
                  description="通常要先累计至少一批 L1 报告后，系统才会抽出跨任务可复用的模式。"
                />
              ) : null}
            </div>
          </div>

          <div
            className="rounded-[28px] border p-5"
            style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-fuchsia-300">L1 Reports</div>
                <div className="mt-2 text-xl font-semibold text-white">结构化工作报告</div>
              </div>
              <div className="text-sm text-slate-400">{reports.length} 条</div>
            </div>

            <div className="mt-4 space-y-3">
              {reports.map((report) => (
                <div
                  key={report.report_id}
                  className="rounded-2xl border border-slate-700/70 bg-slate-950/45 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-fuchsia-400/10 px-3 py-1 text-xs text-fuchsia-200">
                      {report.lobster_id}
                    </span>
                    <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">
                      {report.promoted_to_l2 ? '已升维到 L2' : '待升维'}
                    </span>
                    <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
                      {report.source_token_count} → {report.token_count} tokens
                    </span>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-white">{report.task_summary || '未命名任务'}</div>
                  <div className="mt-2 text-sm text-slate-300">决策: {report.decision || '-'}</div>
                  <div className="mt-1 text-sm text-slate-300">结果: {report.outcome || '-'}</div>
                  {report.next_steps.length ? (
                    <div className="mt-2 text-sm text-slate-300">下一步: {report.next_steps.join('；')}</div>
                  ) : null}
                  {report.key_entities.length ? (
                    <div className="mt-2 text-xs text-slate-400">实体: {report.key_entities.join(', ')}</div>
                  ) : null}
                  <div className="mt-2 text-xs text-slate-500">创建于 {formatDateTime(report.created_at)}</div>
                </div>
              ))}

              {!reports.length ? (
                <EmptyCard
                  title="还没有 L1 报告"
                  description="当龙虾任务成功完成后，会自动把原始对话压缩成结构化报告。"
                />
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <div
            className="rounded-[28px] border p-5"
            style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-emerald-300">Hybrid Search</div>
                <div className="mt-2 text-xl font-semibold text-white">Dense + Sparse 混合检索</div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <input
                value={hybridQuery}
                onChange={(event) => setHybridQuery(event.target.value)}
                placeholder="例如：上次给王老板发的提案"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void runHybridSearch()}
                  disabled={searching || !hybridQuery.trim()}
                  className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/15 disabled:opacity-60"
                >
                  <Brain className="h-4 w-4" />
                  {searching ? '检索中...' : '执行混合检索'}
                </button>
                <div className="rounded-2xl border border-slate-700/70 bg-slate-950/50 px-4 py-2 text-sm text-slate-400">
                  过滤条件会复用当前龙虾/分类筛选
                </div>
              </div>

              <div className="space-y-3">
                {hybridResults.map((item, index) => (
                  <div key={`${index}-${item.final_score}`} className="rounded-2xl border border-slate-700/70 bg-slate-950/45 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-emerald-200">
                        score {item.final_score.toFixed(4)}
                      </span>
                      {typeof item.dense_rank === 'number' ? (
                        <span className="rounded-full bg-white/5 px-3 py-1 text-slate-300">dense #{item.dense_rank}</span>
                      ) : null}
                      {typeof item.sparse_rank === 'number' ? (
                        <span className="rounded-full bg-white/5 px-3 py-1 text-slate-300">sparse #{item.sparse_rank}</span>
                      ) : null}
                    </div>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-sm text-slate-200">
                      {JSON.stringify(item.memory_details, null, 2)}
                    </pre>
                  </div>
                ))}
                {!hybridResults.length ? (
                  <EmptyCard title="还没有混合检索结果" description="输入查询后，这里会展示 Dense + BM25 Sparse 融合后的记忆命中结果。" />
                ) : null}
              </div>
            </div>
          </div>

          <div
            className="rounded-[28px] border p-5"
            style={{ backgroundColor: PANEL_BG, borderColor: BORDER }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-amber-300">Vector Snapshot</div>
                <div className="mt-2 text-xl font-semibold text-white">Qdrant 快照备份</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
              <select
                value={selectedCollection}
                onChange={(event) => setSelectedCollection(event.target.value)}
                className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              >
                <option value="lobster_episodic_memory">lobster_episodic_memory</option>
                <option value="viral_formulas">viral_formulas</option>
              </select>
              <button
                type="button"
                onClick={() => void runVectorBackup()}
                disabled={triggeringBackup}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 hover:bg-amber-500/15 disabled:opacity-60"
              >
                <Database className="h-4 w-4" />
                {triggeringBackup ? '备份中...' : '手动触发快照'}
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-semibold text-white">远端快照</div>
                <div className="space-y-2">
                  {vectorSnapshots.map((snapshot) => (
                    <div key={snapshot.name} className="rounded-2xl border border-slate-700/70 bg-slate-950/45 px-4 py-3 text-sm text-slate-200">
                      <div className="font-mono text-xs text-cyan-200">{snapshot.name}</div>
                      <div className="mt-1 text-xs text-slate-400">{snapshot.creation_time || '-'}</div>
                    </div>
                  ))}
                  {!vectorSnapshots.length ? <EmptyCard title="暂无远端快照" description="选定 collection 后会显示 Qdrant 当前保留的快照版本。" /> : null}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-semibold text-white">本地备份历史</div>
                <div className="space-y-2">
                  {vectorHistory.map((item) => (
                    <div key={item.backup_id} className="rounded-2xl border border-slate-700/70 bg-slate-950/45 px-4 py-3 text-sm text-slate-200">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-fuchsia-200">{item.collection_name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${item.status === 'ok' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'}`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{formatDateTime(item.created_at)}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.backup_path}</div>
                    </div>
                  ))}
                  {!vectorHistory.length ? <EmptyCard title="暂无本地快照历史" description="手动触发一次备份后，这里会显示最近的向量快照记录。" /> : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  helper,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/45 px-4 py-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-sm text-slate-400">{helper}</div>
    </div>
  );
}

function EmptyCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/35 px-5 py-8 text-center">
      <div className="text-lg font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-400">{description}</div>
    </div>
  );
}
