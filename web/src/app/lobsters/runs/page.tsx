'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table/DataTable';
import { expandColumn } from '@/components/data-table/columns';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { RunDetailPanel } from '@/components/lobster/RunDetailPanel';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { fetchLobsters, fetchLobsterRunsPage } from '@/services/endpoints/ai-subservice';
import type { LobsterRun } from '@/types/lobster';

export default function LobsterRunsPage() {
  const [selectedLobsterId, setSelectedLobsterId] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');

  const lobstersQuery = useServerDataTable({
    fetchFn: async ({ page_size }) => {
      const res = await fetchLobsters();
      return {
        data: res.items,
        total: res.count,
        page: 1,
        page_size,
        total_pages: 1,
      };
    },
    defaultPageSize: 50,
  });

  const serverTable = useServerDataTable<LobsterRun>({
    fetchFn: async (params) => {
      const res = await fetchLobsterRunsPage({
        lobster_id: selectedLobsterId || undefined,
        status: selectedStatus || undefined,
        page: params.page,
        page_size: params.page_size,
        sort_by: params.sort_by,
        sort_dir: params.sort_dir,
      });
      return res;
    },
    defaultPageSize: 20,
  });

  const columns = useMemo<ColumnDef<LobsterRun>[]>(
    () => [
      expandColumn<LobsterRun>(),
      {
        accessorKey: 'created_at',
        header: '时间',
        cell: ({ row }) => new Date(row.original.created_at).toLocaleString('zh-CN'),
      },
      { accessorKey: 'lobster_id', header: '龙虾' },
      { accessorKey: 'model_used', header: '模型' },
      { accessorKey: 'status', header: '状态' },
      {
        accessorKey: 'score',
        header: '质量分',
        cell: ({ row }) => (typeof row.original.score === 'number' ? row.original.score.toFixed(1) : '-'),
      },
      {
        accessorKey: 'duration_ms',
        header: '耗时',
        cell: ({ row }) => `${Math.round(row.original.duration_ms || 0)}ms`,
      },
      {
        accessorKey: 'total_tokens',
        header: 'Tokens',
        cell: ({ row }) => String(row.original.total_tokens || 0),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6 p-6">
      <EntityListPage
        title="龙虾执行记录"
        description="服务端分页执行记录页。点击任一行可展开查看输入、输出、质量细项和异常。"
        filters={
          <>
            <label className="text-sm text-slate-300">
              龙虾
              <select value={selectedLobsterId} onChange={(event) => setSelectedLobsterId(event.target.value)} className="ml-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white">
                <option value="">全部</option>
                {(lobstersQuery.data ?? []).map((item) => (
                  <option key={String((item as Record<string, unknown>).id || '')} value={String((item as Record<string, unknown>).id || '')}>
                    {String((item as Record<string, unknown>).zh_name || (item as Record<string, unknown>).display_name || (item as Record<string, unknown>).id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-300">
              状态
              <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)} className="ml-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white">
                <option value="">全部</option>
                <option value="success">success</option>
                <option value="failed">failed</option>
                <option value="running">running</option>
              </select>
            </label>
          </>
        }
      >
        <DataTable
          columns={columns}
          data={serverTable.data}
          loading={serverTable.loading}
          serverSide
          total={serverTable.total}
          pageIndex={serverTable.pageIndex}
          pageSize={serverTable.pageSize}
          onPaginationChange={serverTable.onPaginationChange}
          onSortingChange={serverTable.onSortingChange}
          onColumnFiltersChange={serverTable.onColumnFiltersChange}
          expandable
          renderSubComponent={(row) => <RunDetailPanel run={row.original} />}
          emptyText="暂无执行记录"
        />
      </EntityListPage>
    </div>
  );
}
