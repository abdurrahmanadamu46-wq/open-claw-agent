export const GOVERNANCE_ISSUES_FILTER_LABEL = '仅问题项';
export const GOVERNANCE_VIEW_REPORT_LABEL = '查看完整报告';
export const GOVERNANCE_COPY_REPORT_LABEL = '复制完整报告';

type GovernanceExportOptions<T> = {
  filename: string;
  surface: string;
  filters: Record<string, unknown>;
  items: T[];
};

export function downloadGovernanceExport<T>({
  filename,
  surface,
  filters,
  items,
}: GovernanceExportOptions<T>): void {
  const payload = {
    exported_at: new Date().toISOString(),
    surface,
    filters,
    count: items.length,
    items,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function formatGovernanceExportNotice(count: number): string {
  return `已导出 ${count} 条治理结果。`;
}
