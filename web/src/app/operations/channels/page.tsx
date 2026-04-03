'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { RefreshCw } from 'lucide-react';
import { ChannelPieChart } from '@/components/charts/ChannelPieChart';
import { DataTable } from '@/components/data-table/DataTable';
import { selectColumn } from '@/components/data-table/columns';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { Button } from '@/components/ui/Button';
import { fetchChannelStatus, updateChannelAccountOptions, type ChannelAccountSummary } from '@/services/endpoints/ai-subservice';

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
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedRows, setSelectedRows] = useState<ChannelRow[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchChannelStatus();
      setChannels(data);
      setNotice('已同步渠道账号与 dmScope 配置。');
    } catch (error) {
      setNotice(normalizeAxiosError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

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

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#07111f] p-6 text-slate-100">
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
    </div>
  );
}
