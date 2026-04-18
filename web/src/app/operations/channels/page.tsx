'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { RefreshCw, Sparkles } from 'lucide-react';
import { ChannelPieChart } from '@/components/charts/ChannelPieChart';
import { DataTable } from '@/components/data-table/DataTable';
import { selectColumn } from '@/components/data-table/columns';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { Button } from '@/components/ui/Button';
import {
  downloadGovernanceExport,
  formatGovernanceExportNotice,
  GOVERNANCE_COPY_REPORT_LABEL,
  GOVERNANCE_ISSUES_FILTER_LABEL,
  GOVERNANCE_VIEW_REPORT_LABEL,
} from '@/lib/governance';
import { fetchChannelStatus, fetchEdgeAdapterManifestDetail, fetchEdgeAdapterManifests, updateChannelAccountOptions, type ChannelAccountSummary, type EdgeAdapterManifestSummary } from '@/services/endpoints/ai-subservice';

type ChannelGroup = {
  total: number;
  enabled: number;
  accounts: ChannelAccountSummary[];
};

type ChannelRow = ChannelAccountSummary & {
  channel: string;
  key: string;
};

function normalizeAxiosError(error: unknown): string {
  const maybe = error as { response?: { status?: number; data?: { message?: string; detail?: string } }; message?: string };
  const status = maybe?.response?.status;
  const detail = maybe?.response?.data?.message || maybe?.response?.data?.detail;
  if (status && detail) return `请求失败 (${status}): ${detail}`;
  if (status) return `请求失败 (${status})`;
  return maybe?.message || '请求失败';
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Record<string, ChannelGroup>>({});
  const [adapterManifests, setAdapterManifests] = useState<EdgeAdapterManifestSummary[]>([]);
  const [adapterDetail, setAdapterDetail] = useState<EdgeAdapterManifestSummary | null>(null);
  const [activeAdapterReport, setActiveAdapterReport] = useState<EdgeAdapterManifestSummary | null>(null);
  const [adapterDetailLoading, setAdapterDetailLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedAdapterScanStatus, setSelectedAdapterScanStatus] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedRows, setSelectedRows] = useState<ChannelRow[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [data, adapterData] = await Promise.all([fetchChannelStatus(), fetchEdgeAdapterManifests()]);
      setChannels(data);
      setAdapterManifests(adapterData.items || []);
      setNotice('已同步渠道账号与 dmScope 配置。');
    } catch (error) {
      setNotice(normalizeAxiosError(error));
      setAdapterManifests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredAdapterManifests = useMemo(() => {
    return adapterManifests.filter((adapter) => {
      const scanStatus = String(adapter.scan_status || 'not_scanned');
      if (selectedAdapterScanStatus === 'all') return true;
      if (selectedAdapterScanStatus === 'issues') return scanStatus === 'warn' || scanStatus === 'block';
      return scanStatus === selectedAdapterScanStatus;
    });
  }, [adapterManifests, selectedAdapterScanStatus]);

  const rows = useMemo<ChannelRow[]>(() => {
    const keyword = search.trim().toLowerCase();
    return Object.entries(channels).flatMap(([channel, group]) =>
      group.accounts
        .map((account) => ({
          ...account,
          channel,
          key: `${channel}:${account.id}`,
        }))
        .filter((account) => [channel, account.name, account.id].join(' ').toLowerCase().includes(keyword)),
    );
  }, [channels, search]);

  const columns = useMemo<ColumnDef<ChannelRow>[]>(
    () => [
      selectColumn<ChannelRow>(),
      { accessorKey: 'channel', header: '渠道' },
      { accessorKey: 'name', header: '账号名' },
      { accessorKey: 'id', header: '账号 ID' },
      {
        accessorKey: 'enabled',
        header: '状态',
        cell: ({ row }) => (row.original.enabled ? '已启用' : '已停用'),
      },
      {
        accessorKey: 'dm_scope',
        header: '会话隔离',
        cell: ({ row }) => String(row.original.options?.dm_scope || 'shared'),
      },
    ],
    [],
  );

  const applyBatchScope = async (dmScope: 'shared' | 'per-peer' | 'isolated') => {
    if (selectedRows.length === 0) return;
    try {
      await Promise.all(
        selectedRows.map((row) =>
          updateChannelAccountOptions({
            channel: row.channel,
            account_id: row.id,
            dm_scope: dmScope,
          }),
        ),
      );
      setNotice(`已批量更新 ${selectedRows.length} 个账号的隔离模式为 ${dmScope}。`);
      await load();
    } catch (error) {
      setNotice(normalizeAxiosError(error));
    }
  };

  const openAdapterDetail = async (platform: string) => {
    setAdapterDetailLoading(true);
    try {
      const detail = await fetchEdgeAdapterManifestDetail(platform);
      setAdapterDetail(detail.adapter);
    } catch (error) {
      setNotice(normalizeAxiosError(error));
    } finally {
      setAdapterDetailLoading(false);
    }
  };

  const handleCopyAdapterIssues = async (adapter: EdgeAdapterManifestSummary) => {
    const issues = (adapter.scan_report?.issues || []).filter(Boolean);
    if (issues.length === 0) {
      setNotice(`适配器 ${adapter.platform} 当前没有可复制的问题。`);
      return;
    }
    const content = [`${adapter.display_name} (${adapter.platform})`, ...issues.map((issue, index) => `${index + 1}. ${issue}`)].join('\n');
    try {
      await navigator.clipboard.writeText(content);
      setNotice(`已复制适配器 ${adapter.platform} 的 ${issues.length} 条问题。`);
    } catch {
      setNotice(`复制适配器 ${adapter.platform} 的问题失败，请检查浏览器剪贴板权限。`);
    }
  };

  const handleCopyAdapterJson = async (adapter: EdgeAdapterManifestSummary) => {
    const payload = adapter.scan_report || {};
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setNotice(`已复制适配器 ${adapter.platform} 的 scan JSON。`);
    } catch {
      setNotice(`复制适配器 ${adapter.platform} 的 scan JSON 失败，请检查浏览器剪贴板权限。`);
    }
  };

  const handleCopyAdapterReport = async (adapter: EdgeAdapterManifestSummary) => {
    const issues = (adapter.scan_report?.issues || []).filter(Boolean);
    const content = [
      `Adapter: ${adapter.display_name}`,
      `Platform: ${adapter.platform}`,
      `Version: ${adapter.version}`,
      `Status: ${adapter.status}`,
      `Risk: ${adapter.risk_level}`,
      `Scan: ${adapter.scan_status || 'not_scanned'}`,
      typeof adapter.scan_report?.confidence === 'number'
        ? `Confidence: ${(adapter.scan_report.confidence * 100).toFixed(0)}%`
        : null,
      '',
      'Issues:',
      ...(issues.length ? issues.map((issue, index) => `${index + 1}. ${issue}`) : ['(none)']),
      '',
      'Raw JSON:',
      JSON.stringify(adapter.scan_report || {}, null, 2),
    ]
      .filter((line) => line !== null)
      .join('\n');
    try {
      await navigator.clipboard.writeText(content);
      setNotice(`已复制适配器 ${adapter.platform} 的完整报告。`);
    } catch {
      setNotice(`复制适配器 ${adapter.platform} 的完整报告失败，请检查浏览器剪贴板权限。`);
    }
  };

  const handleExportAdapters = () => {
    downloadGovernanceExport({
      filename: `edge-adapters-${selectedAdapterScanStatus}.json`,
      surface: 'edge_adapters',
      filters: {
        scan_status: selectedAdapterScanStatus,
      },
      items: filteredAdapterManifests,
    });
    setNotice(formatGovernanceExportNotice(filteredAdapterManifests.length));
  };

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <EntityListPage
          title="渠道管理"
          description="统一 DataTable 列表页，支持搜索、批量选择和批量切换会话隔离模式。"
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="搜索渠道 / 账号 / ID"
          primaryAction={
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800/70"
            >
              <RefreshCw className="h-4 w-4" />
              {loading ? '刷新中...' : '刷新'}
            </button>
          }
        >
          {notice ? <div className="mb-4 text-sm text-cyan-200">{notice}</div> : null}

          <div className="mb-5 grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <ChannelPieChart
              title="账号平台分布"
              data={Object.entries(channels).map(([platform, group]) => ({
                platform,
                count: group.total,
              }))}
            />
            <div className="grid gap-3 md:grid-cols-3">
              {Object.entries(channels).map(([channel, group]) => (
                <div key={channel} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
                  <div className="text-sm font-semibold text-white">{channel}</div>
                  <div className="mt-2 text-2xl font-semibold text-cyan-100">{group.total}</div>
                  <div className="mt-1 text-xs text-slate-400">启用中 {group.enabled} 个</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Link
              href="/operations/channels/xiaohongshu"
              className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 transition hover:border-red-300/40 hover:bg-red-400/15"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-red-100">
                <Sparkles className="h-4 w-4" />
                Xiaohongshu Channel Supervisor
              </div>
              <div className="mt-2 text-sm leading-6 text-red-50/90">
                进入小红书专项页，直接把结构化竞品样本送入 tenant competitive intel / RAG。
              </div>
            </Link>
          </div>

          <div className="mb-5 rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Edge Adapter Manifest</div>
                <div className="mt-2 text-lg font-semibold text-white">边缘渠道适配器能力清单</div>
                <div className="mt-2 text-sm text-slate-400">
                  这里直接消费 `/api/v1/ai/edge/adapters`，帮助研发和运营快速确认哪些平台已经进入资产层、风险等级如何、是否支持 replay/canary。
                </div>
              </div>
              <div className="text-xs text-slate-500">已注册 {adapterManifests.length} 个平台适配器</div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">当前过滤：</span>
              <select
                value={selectedAdapterScanStatus}
                onChange={(e) => setSelectedAdapterScanStatus(e.target.value)}
                className="rounded border border-white/10 bg-slate-950 px-2 py-1 text-xs text-slate-100"
              >
                <option value="all">全部</option>
                <option value="issues">{GOVERNANCE_ISSUES_FILTER_LABEL}</option>
                <option value="not_scanned">not_scanned</option>
                <option value="safe">safe</option>
                <option value="warn">warn</option>
                <option value="block">block</option>
              </select>
              <button
                type="button"
                onClick={() => setSelectedAdapterScanStatus('issues')}
                className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-100 hover:bg-amber-500/15"
              >
                只看有问题适配器
              </button>
              <button
                type="button"
                onClick={() => setSelectedAdapterScanStatus('all')}
                className="rounded border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-200 hover:bg-white/10"
              >
                清空过滤
              </button>
              <button
                type="button"
                onClick={handleExportAdapters}
                className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100 hover:bg-cyan-500/15"
              >
                导出当前结果
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredAdapterManifests.length ? (
                filteredAdapterManifests.map((adapter) => (
                  <div key={adapter.platform} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-white">{adapter.display_name}</div>
                        <div className="mt-1 font-mono text-xs text-slate-400">{adapter.platform}</div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${adapter.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300'}`}>
                        {adapter.status}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className={`rounded-full px-2 py-0.5 ${riskTone(adapter.risk_level)}`}>risk {adapter.risk_level}</span>
                      <span className={`rounded-full px-2 py-0.5 ${scanTone(adapter.scan_status)}`}>scan {adapter.scan_status || 'not_scanned'}</span>
                      {adapter.requires_local_session ? <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-cyan-300">local session</span> : null}
                      {adapter.supports_replay ? <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-300">replay</span> : null}
                      {adapter.supports_canary ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-300">canary</span> : null}
                    </div>

                    <div className="mt-3 text-xs text-slate-300">
                      <div>动作数：{adapter.actions.length}</div>
                      <div className="mt-1">基础 primitive：{adapter.required_primitives.length}</div>
                      {adapter.scan_report?.issues?.[0] ? <div className="mt-2 text-amber-200">scan：{adapter.scan_report.issues[0]}</div> : null}
                      {adapter.known_limitations?.[0] ? <div className="mt-2 text-slate-500">限制：{adapter.known_limitations[0]}</div> : null}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void openAdapterDetail(adapter.platform)}
                        className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100"
                      >
                        {adapterDetailLoading && adapterDetail?.platform === adapter.platform ? '加载中...' : '查看详情'}
                      </button>
                      {adapter.scan_report?.issues?.length ? (
                        <button
                          type="button"
                          onClick={() => void handleCopyAdapterIssues(adapter)}
                          className="rounded-xl border border-white/12 px-3 py-2 text-xs text-slate-200"
                        >
                          复制问题
                        </button>
                      ) : null}
                      {adapter.scan_report ? (
                        <button
                          type="button"
                          onClick={() => setActiveAdapterReport(adapter)}
                          className="rounded-xl border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-xs text-violet-100"
                        >
                          {GOVERNANCE_VIEW_REPORT_LABEL}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                  当前过滤条件下暂无适配器结果。
                </div>
              )}
            </div>
          </div>

          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            selectable
            onSelectionChange={setSelectedRows}
            batchActions={
              <>
                <Button variant="ghost" onClick={() => void applyBatchScope('shared')}>
                  批量设为 shared
                </Button>
                <Button variant="ghost" onClick={() => void applyBatchScope('per-peer')}>
                  批量设为 per-peer
                </Button>
                <Button variant="ghost" onClick={() => void applyBatchScope('isolated')}>
                  批量设为 isolated
                </Button>
              </>
            }
            emptyText="暂无匹配渠道账号"
          />
        </EntityListPage>
      </div>

      {adapterDetail ? (
        <EdgeAdapterDetailPanel
          adapter={adapterDetail}
          onClose={() => setAdapterDetail(null)}
          onCopyIssues={() => void handleCopyAdapterIssues(adapterDetail)}
          onCopyJson={() => void handleCopyAdapterJson(adapterDetail)}
          onCopyFullReport={() => void handleCopyAdapterReport(adapterDetail)}
          onOpenReport={() => setActiveAdapterReport(adapterDetail)}
        />
      ) : null}
      {activeAdapterReport ? (
        <AdapterScanReportDialog
          adapter={activeAdapterReport}
          onClose={() => setActiveAdapterReport(null)}
          onCopyIssues={() => void handleCopyAdapterIssues(activeAdapterReport)}
          onCopyJson={() => void handleCopyAdapterJson(activeAdapterReport)}
          onCopyFullReport={() => void handleCopyAdapterReport(activeAdapterReport)}
        />
      ) : null}
    </div>
  );
}

function riskTone(level: string) {
  if (level === 'high') return 'bg-rose-500/15 text-rose-300';
  if (level === 'medium') return 'bg-amber-500/15 text-amber-300';
  return 'bg-emerald-500/15 text-emerald-300';
}

function scanTone(status?: string) {
  if (status === 'block') return 'bg-rose-500/15 text-rose-300';
  if (status === 'warn') return 'bg-amber-500/15 text-amber-300';
  if (status === 'safe') return 'bg-emerald-500/15 text-emerald-300';
  return 'bg-slate-500/15 text-slate-300';
}

function EdgeAdapterDetailPanel({
  adapter,
  onClose,
  onCopyIssues,
  onCopyJson,
  onCopyFullReport,
  onOpenReport,
}: {
  adapter: EdgeAdapterManifestSummary;
  onClose: () => void;
  onCopyIssues: () => void;
  onCopyJson: () => void;
  onCopyFullReport: () => void;
  onOpenReport: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-[#0f172a] p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-cyan-300">Adapter Detail</div>
            <div className="mt-2 text-xl font-semibold text-white">{adapter.display_name}</div>
            <div className="mt-1 font-mono text-xs text-slate-400">{adapter.platform} · v{adapter.version}</div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCopyJson}
              className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200"
            >
              复制 JSON
            </button>
            <button
              type="button"
              onClick={onCopyFullReport}
              className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200"
            >
              {GOVERNANCE_COPY_REPORT_LABEL}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 ${adapter.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300'}`}>
            {adapter.status}
          </span>
          <span className={`rounded-full px-2 py-0.5 ${riskTone(adapter.risk_level)}`}>risk {adapter.risk_level}</span>
          <span className={`rounded-full px-2 py-0.5 ${scanTone(adapter.scan_status)}`}>scan {adapter.scan_status || 'not_scanned'}</span>
          {adapter.requires_local_session ? <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-cyan-300">local session</span> : null}
          {adapter.supports_replay ? <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-300">replay</span> : null}
          {adapter.supports_canary ? <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-300">canary</span> : null}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Supported Actions</div>
            <div className="mt-3 space-y-2">
              {adapter.actions.map((item) => (
                <div key={item} className="rounded-xl bg-black/20 px-3 py-2 text-sm text-slate-200">{item}</div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Required Primitives</div>
            <div className="mt-3 space-y-2">
              {adapter.required_primitives.map((item) => (
                <div key={item} className="rounded-xl bg-black/20 px-3 py-2 text-sm text-slate-200">{item}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Governance Scan</div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 ${scanTone(adapter.scan_status)}`}>scan {adapter.scan_status || 'not_scanned'}</span>
            {typeof adapter.scan_report?.confidence === 'number' ? (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-300">
                confidence {(adapter.scan_report.confidence * 100).toFixed(0)}%
              </span>
            ) : null}
            {adapter.scan_report?.issues?.length ? (
              <button
                type="button"
                onClick={onCopyIssues}
                className="rounded-full bg-white/10 px-2 py-0.5 text-slate-300"
              >
                复制问题
              </button>
            ) : null}
            <button
              type="button"
              onClick={onOpenReport}
              className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-200"
            >
              {GOVERNANCE_VIEW_REPORT_LABEL}
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {adapter.scan_report?.issues?.length ? (
              adapter.scan_report.issues.map((item) => (
                <div key={item} className="rounded-xl bg-slate-950/40 px-3 py-2 text-sm text-slate-200">{item}</div>
              ))
            ) : (
              <div className="text-sm text-slate-500">未扫描到明显 manifest 风险。</div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Known Limitations</div>
          <div className="mt-3 space-y-2">
            {adapter.known_limitations?.length ? (
              adapter.known_limitations.map((item) => (
                <div key={item} className="rounded-xl bg-slate-950/40 px-3 py-2 text-sm text-slate-200">{item}</div>
              ))
            ) : (
              <div className="text-sm text-slate-500">暂无限制说明</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdapterScanReportDialog({
  adapter,
  onClose,
  onCopyIssues,
  onCopyJson,
  onCopyFullReport,
}: {
  adapter: EdgeAdapterManifestSummary;
  onClose: () => void;
  onCopyIssues: () => void;
  onCopyJson: () => void;
  onCopyFullReport: () => void;
}) {
  const report = adapter.scan_report || {};
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const confidence = typeof report.confidence === 'number' ? report.confidence : null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-[#0f172a] p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-violet-300">Adapter Scan Report</div>
            <div className="mt-2 text-xl font-semibold text-white">{adapter.display_name}</div>
            <div className="mt-1 text-xs text-slate-400">
              {adapter.platform} / {adapter.version} / {adapter.scan_status || 'not_scanned'}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCopyJson}
              className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200"
            >
              复制 JSON
            </button>
            <button
              type="button"
              onClick={onCopyFullReport}
              className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200"
            >
              {GOVERNANCE_COPY_REPORT_LABEL}
            </button>
            {issues.length ? (
              <button
                type="button"
                onClick={onCopyIssues}
                className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200"
              >
                复制问题
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/12 px-3 py-2 text-sm text-slate-200"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 ${riskTone(adapter.risk_level)}`}>risk {adapter.risk_level}</span>
          <span className={`rounded-full px-2 py-0.5 ${scanTone(adapter.scan_status)}`}>scan {adapter.scan_status || 'not_scanned'}</span>
          {confidence !== null ? (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-300">confidence {(confidence * 100).toFixed(0)}%</span>
          ) : null}
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-300">issues {issues.length}</span>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.95fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Issues</div>
            <div className="mt-3 space-y-2">
              {issues.length ? (
                issues.map((issue) => (
                  <div key={issue} className="rounded-xl bg-slate-950/40 px-3 py-2 text-sm text-slate-200">{issue}</div>
                ))
              ) : (
                <div className="text-sm text-slate-500">当前没有 scan issues。</div>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Raw JSON</div>
            <pre className="mt-3 max-h-[360px] overflow-auto rounded-xl bg-slate-950/40 p-3 text-xs text-slate-300">
              {JSON.stringify(report, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
