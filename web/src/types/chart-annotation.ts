export type ChartAnnotationSeverity = 'info' | 'warning' | 'critical';

export interface ChartAnnotation {
  id: string;
  timestamp: string;
  label: string;
  description: string;
  annotation_type: string;
  severity: ChartAnnotationSeverity;
  lobster_id?: string | null;
  tenant_id?: string | null;
  source_audit_log_id?: string | null;
  color?: string;
}
