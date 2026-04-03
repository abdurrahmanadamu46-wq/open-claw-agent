export type OperationAuditStatus = 'success' | 'failed';

export interface OperationAuditLogRecord {
  id: string;
  ts: string;
  tenantId?: string;
  userId?: string;
  username?: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  method: string;
  path: string;
  ipAddress?: string;
  requestBody?: string;
  responseStatus: OperationAuditStatus;
  errorMessage?: string;
  duration: number;
}

export interface OperationAuditLogQuery {
  tenantId?: string;
  userId?: string;
  action?: string;
  resource?: string;
  responseStatus?: OperationAuditStatus;
  page?: number;
  limit?: number;
}

export interface OperationAuditLogListResponse {
  items: OperationAuditLogRecord[];
  total: number;
  page: number;
  limit: number;
}
