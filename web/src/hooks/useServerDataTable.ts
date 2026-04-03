'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ServerTableFetchParams {
  page: number;
  page_size: number;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  filters?: Record<string, unknown>;
}

export function useServerDataTable<T>({
  fetchFn,
  defaultPageSize = 20,
  externalFilters = {},
}: {
  fetchFn: (params: ServerTableFetchParams) => Promise<PaginatedResponse<T>>;
  defaultPageSize?: number;
  externalFilters?: Record<string, unknown>;
}) {
  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const externalFiltersKey = JSON.stringify(externalFilters);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const filters = {
        ...externalFilters,
        ...Object.fromEntries(columnFilters.map((item) => [item.id, item.value])),
      };
      const result = await fetchFn({
        page: pageIndex + 1,
        page_size: pageSize,
        sort_by: sorting[0]?.id,
        sort_dir: sorting[0]?.desc ? 'desc' : 'asc',
        filters,
      });
      setData(result.data);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, [columnFilters, externalFilters, fetchFn, pageIndex, pageSize, sorting]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPageIndex(0);
  }, [externalFiltersKey]);

  return {
    data,
    total,
    loading,
    pageIndex,
    pageSize,
    sorting,
    columnFilters,
    onPaginationChange: ({ pageIndex: nextPageIndex, pageSize: nextPageSize }: PaginationState) => {
      setPageIndex(nextPageIndex);
      setPageSize(nextPageSize);
    },
    onSortingChange: (nextSorting: SortingState) => {
      setPageIndex(0);
      setSorting(nextSorting);
    },
    onColumnFiltersChange: (nextFilters: ColumnFiltersState) => {
      setPageIndex(0);
      setColumnFilters(nextFilters);
    },
    refresh: fetchData,
  };
}
