'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { ConfigDiffPanel } from '@/components/audit/ConfigDiffPanel';
import { DataTable } from '@/components/data-table/DataTable';
import { expandColumn } from '@/components/data-table/columns';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { fetchAuditEventTypes, fetchAuditEvents, runAuditCleanup } from '@/services/endpoints/ai-subservice';
import type { AuditEvent, AuditEventCategory, AuditSeverity } from '@/types/audit-log';

export default function AuditSettingsPage() {
  const [selectedEventType, setSelectedEventType] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState<AuditSeverity | ''>('');
  const [selectedCategory, setSelectedCategory] = useState<AuditEventCategory | ''>('');
  const [message, setMessage] = useState('');

  const eventTypesQuery = useServerDataTable({
    fetchFn: async ({ page_size }) => {
      const result = await fetchAuditEventTypes();
      return {
        data: result.items,
        total: result.items.length,
        page: 1,
        page_size,
        total_pages: 1,
      };
    },
    defaultPageSize: 200,
  });

  const serverTable = useServerDataTable<AuditEvent>({
    fetchFn: async (params) => {
      const result = await fetchAuditEvents({
        event_type: selectedEventType ? [selectedEventType] : undefined,
        severity: selectedSeverity ? [selectedSeverity] : undefined,
        category: selectedCategory ? [selectedCategory] : undefined,
        page: params.page,
        page_size: params.page_size,
        sort_by: params.sort_by,
        sort_dir: params.sort_dir,
      });
      return {
        data: result.data || result.items,
        total: result.total,
        page: result.page,
        page_size: result.page_size,
        total_pages: result.total_pages,
      };
    },
    defaultPageSize: 50,
  });

  const categories = useMemo(
    () =>
      Array.from(new Set((eventTypesQuery.data ?? []).map((item) => item.category as string))).sort(),
    [eventTypesQuery.data],
  );

  const columns = useMemo<ColumnDef<AuditEvent>[]>(
    () => [
      expandColumn<AuditEvent>(),
      {
        accessorKey: 'created_at',
        header: '时间',
        cell: ({ row }) => <span className="text-slate-300">{new Date(row.original.created_at).toLocaleString('zh-CN')}</span>,
      },
      {
        accessorKey: 'event_type',
        header: '事件类型',
        cell: ({ row }) => <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-cyan-100">{row.original.event_type}</span>,
      },
      { accessorKey: 'category', header: '分类' },
      { accessorKey: 'severity', header: '严重级别' },
      { accessorKey: 'resource_type', header: '资源类型' },
      { accessorKey: 'resource_id', header: '资源 ID' },
    ],
    [],
  );

  async function handleCleanup() {
    try {
      const res = await runAuditCleanup();
      setMessage(`已触发审计清理：${JSON.stringify(res.result)}`);
      await serverTable.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '清理失败');
    }
  }

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-white">
              <ShieldAlert className="h-5 w-5 text-cyan-300" />
              <h1 className="text-2xl font-semibold">审计事件中心</h1>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              已切换为 TanStack Table 服务端模式。排序、分页都在服务端执行，点击行可展开查看完整 diff / details。
            </p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => void handleCleanup()} className="rounded-2xl border border-amber-400/35 bg-amber-400/10 px-4 py-2 text-sm text-amber-100">
              运行清理
            </button>
            <button type="button" onClick={() => void serverTable.refresh()} className="rounded-2xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100">
              <RefreshCw className="mr-2 inline h-4 w-4" />
              刷新
            </button>
          </div>
        </div>
        {message ? <div className="mt-3 text-sm text-cyan-100">{message}</div> : null}
      </section>

      <EntityListPage
        title="审计日志"
        description="服务端分页 + 行展开。筛选条件变化后会自动回到第一页重新拉取。"
        filters={
          <>
            <label className="text-sm text-slate-300">
              事件类型
              <select value={selectedEventType} onChange={(e) => setSelectedEventType(e.target.value)} className="ml-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white">
                <option value="">全部</option>
                {(eventTypesQuery.data ?? []).map((item) => (
                  <option key={item.event_type} value={item.event_type}>{item.event_type}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-300">
              严重级别
              <select value={selectedSeverity} onChange={(e) => setSelectedSeverity(e.target.value as AuditSeverity | '')} className="ml-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white">
                <option value="">全部</option>
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="ERROR">ERROR</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </label>
            <label className="text-sm text-slate-300">
              分类
              <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value as AuditEventCategory | '')} className="ml-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white">
                <option value="">全部</option>
                {categories.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
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
          renderSubComponent={(row) => <ConfigDiffPanel log={row.original} />}
          emptyText="暂无匹配事件"
        />
      </EntityListPage>
    </div>
  );
}
