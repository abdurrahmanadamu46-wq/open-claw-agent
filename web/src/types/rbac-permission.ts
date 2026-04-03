export type ResourceType =
  | 'lobster'
  | 'workflow'
  | 'channel'
  | 'api_key'
  | 'edge_node'
  | 'skill'
  | 'memory'
  | 'report'
  | 'tenant';

export type ResourceScope = 'read' | 'write' | 'execute' | 'admin';
export type SubjectType = 'role' | 'user';

export interface ResourcePermission {
  id: string;
  tenant_id: string;
  resource_type: ResourceType | '*';
  resource_id: string;
  scope: ResourceScope;
  subject_type: SubjectType;
  subject_id: string;
  granted: boolean;
  created_at: string;
  note?: string;
  source?: 'custom' | 'default_role';
}

export interface PermissionCheckResult {
  allowed: boolean;
  matched_rule: ResourcePermission | null;
  reason: string;
}
