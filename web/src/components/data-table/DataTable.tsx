'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ExpandedState,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  emptyText?: string;
  onRowClick?: (row: T) => void;
  serverSide?: boolean;
  total?: number;
  pageIndex?: number;
  pageSize?: number;
  onPaginationChange?: (pagination: PaginationState) => void;
  onSortingChange?: (sorting: SortingState) => void;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
  selectable?: boolean;
  onSelectionChange?: (rows: T[]) => void;
  batchActions?: React.ReactNode;
  expandable?: boolean;
  renderSubComponent?: (row: Row<T>) => React.ReactNode;
  getRowCanExpand?: (row: Row<T>) => boolean;
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  emptyText = '暂无数据',
  onRowClick,
  serverSide = false,
  total = 0,
  pageIndex = 0,
  pageSize = 20,
  onPaginationChange,
  onSortingChange,
  onColumnFiltersChange,
  selectable = false,
  onSelectionChange,
  batchActions,
  expandable = false,
  renderSubComponent,
  getRowCanExpand,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [internalPagination, setInternalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const controlledPagination = useMemo<PaginationState>(
    () => ({ pageIndex, pageSize }),
    [pageIndex, pageSize],
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      rowSelection,
      expanded,
      pagination: serverSide ? controlledPagination : internalPagination,
    },
    manualPagination: serverSide,
    manualSorting: serverSide,
    manualFiltering: serverSide,
    pageCount: serverSide ? Math.max(1, Math.ceil(total / Math.max(pageSize, 1))) : undefined,
    enableRowSelection: selectable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: serverSide ? undefined : getSortedRowModel(),
    getFilteredRowModel: serverSide ? undefined : getFilteredRowModel(),
    getPaginationRowModel: serverSide ? undefined : getPaginationRowModel(),
    getExpandedRowModel: expandable ? getExpandedRowModel() : undefined,
    getRowCanExpand: expandable ? (getRowCanExpand ?? (() => true)) : undefined,
    onRowSelectionChange: setRowSelection,
    onExpandedChange: setExpanded,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(next);
      if (serverSide) {
        onPaginationChange?.({ pageIndex: 0, pageSize });
      }
      onSortingChange?.(next);
    },
    onColumnFiltersChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnFilters) : updater;
      setColumnFilters(next);
      if (serverSide) {
        onPaginationChange?.({ pageIndex: 0, pageSize });
      }
      onColumnFiltersChange?.(next);
    },
    onPaginationChange: serverSide
      ? (updater) => {
          const next = typeof updater === 'function' ? updater(controlledPagination) : updater;
          onPaginationChange?.(next);
        }
      : setInternalPagination,
  });

  const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original);

  useEffect(() => {
    onSelectionChange?.(selectedRows);
  }, [onSelectionChange, selectedRows]);

  const currentPageIndex = serverSide ? pageIndex : internalPagination.pageIndex;
  const currentPageSize = serverSide ? pageSize : internalPagination.pageSize;
  const pageCount = serverSide ? Math.max(1, Math.ceil(total / Math.max(pageSize, 1))) : table.getPageCount();

  return (
    <div className="space-y-3">
      {selectable && selectedRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          <span>已选 {selectedRows.length} 项</span>
          <button
            type="button"
            onClick={() => table.resetRowSelection()}
            className="text-xs text-slate-300 transition hover:text-white"
          >
            取消选择
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">{batchActions}</div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.02] shadow-[0_24px_80px_-40px_rgba(2,6,23,0.7)]">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/8 bg-black/20 text-slate-400">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-3 font-medium">
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className={cn(
                          'inline-flex items-center gap-1',
                          header.column.getCanSort() ? 'cursor-pointer select-none' : 'cursor-default',
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() ? (
                          <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                            {header.column.getIsSorted() === 'asc'
                              ? 'Asc'
                              : header.column.getIsSorted() === 'desc'
                                ? 'Desc'
                                : ''}
                          </span>
                        ) : null}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {loading ? (
              Array.from({ length: Math.max(4, Math.min(currentPageSize, 8)) }).map((_, index) => (
                <tr key={`skeleton-${index}`} className="border-b border-white/6 last:border-0">
                  <td className="px-4 py-3" colSpan={columns.length}>
                    <Skeleton className="h-8 rounded-xl bg-slate-900/70" />
                  </td>
                </tr>
              ))
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className={cn(
                      'border-b border-white/6 last:border-0 transition',
                      expandable || onRowClick ? 'cursor-pointer hover:bg-white/[0.03]' : '',
                      row.getIsExpanded() && 'bg-cyan-500/[0.04]',
                    )}
                    onClick={() => {
                      if (expandable) {
                        row.toggleExpanded();
                        return;
                      }
                      onRowClick?.(row.original);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 text-slate-100">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  {row.getIsExpanded() && renderSubComponent ? (
                    <tr className="border-b border-white/6 bg-black/20">
                      <td className="px-4 py-4" colSpan={row.getVisibleCells().length}>
                        {renderSubComponent(row)}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            ) : (
              <tr>
                <td className="px-4 py-10 text-center text-slate-500" colSpan={columns.length}>
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
        <div>
          {serverSide ? `共 ${total} 条 · 第 ${currentPageIndex + 1} / ${pageCount} 页` : `当前 ${table.getRowModel().rows.length} 条`}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={String(currentPageSize)}
            onChange={(event) => {
              const nextSize = Number(event.target.value);
              const next = { pageIndex: 0, pageSize: nextSize };
              if (serverSide) onPaginationChange?.(next);
              else table.setPagination(next);
            }}
            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size} / 页
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              serverSide
                ? onPaginationChange?.({ pageIndex: Math.max(0, currentPageIndex - 1), pageSize: currentPageSize })
                : table.previousPage()
            }
            disabled={currentPageIndex <= 0}
            className="rounded-xl border border-white/10 px-3 py-2 text-slate-200 transition hover:bg-white/[0.05] disabled:opacity-40"
          >
            上一页
          </button>
          <button
            type="button"
            onClick={() =>
              serverSide
                ? onPaginationChange?.({ pageIndex: Math.min(pageCount - 1, currentPageIndex + 1), pageSize: currentPageSize })
                : table.nextPage()
            }
            disabled={currentPageIndex >= pageCount - 1}
            className="rounded-xl border border-white/10 px-3 py-2 text-slate-200 transition hover:bg-white/[0.05] disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
