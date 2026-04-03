'use client';

import { ChevronRight } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Checkbox } from '@/components/ui/Checkbox';

export const expandColumn = <T,>(): ColumnDef<T> => ({
  id: 'expand',
  header: () => null,
  cell: ({ row }) =>
    row.getCanExpand() ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          row.toggleExpanded();
        }}
        className="rounded-lg p-1 text-slate-400 transition hover:bg-white/[0.08] hover:text-white"
      >
        <ChevronRight
          className="h-4 w-4 transition-transform duration-150"
          style={{ transform: row.getIsExpanded() ? 'rotate(90deg)' : 'rotate(0deg)' }}
        />
      </button>
    ) : null,
  size: 44,
  enableSorting: false,
});

export const selectColumn = <T,>(): ColumnDef<T> => ({
  id: 'select',
  header: ({ table }) => (
    <Checkbox
      checked={table.getIsAllPageRowsSelected()}
      indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
      onChange={(event) => table.toggleAllPageRowsSelected(event.target.checked)}
      aria-label="全选当前页"
    />
  ),
  cell: ({ row }) => (
    <Checkbox
      checked={row.getIsSelected()}
      onChange={(event) => row.toggleSelected(event.target.checked)}
      onClick={(event) => event.stopPropagation()}
      aria-label="选择当前行"
    />
  ),
  size: 48,
  enableSorting: false,
});
