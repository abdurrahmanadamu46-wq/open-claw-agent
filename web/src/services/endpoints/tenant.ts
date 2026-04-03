import api from '../api';

export type LeadScoringWords = {
  highIntent: string[];
  painPoints: string[];
};

export type NodeWorkflowProgress = {
  S1: boolean;
  S2: boolean;
  S3: boolean;
  S4: boolean;
  S5: boolean;
};

export type TenantRegistryItem = {
  id: string;
  name: string;
  quota: number;
  inactive: boolean;
  industryType?: string;
  industryCategoryTag?: string;
  businessKeywords: string[];
  leadScoringWords: LeadScoringWords;
  nodeWorkflowProgress: NodeWorkflowProgress;
  deploymentRegion: string;
  storageRegion: string;
  dataResidency: 'cn-mainland' | 'custom';
  icpFilingStatus: 'pending' | 'ready' | 'submitted' | 'approved';
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type TenantRegistryPatch = Partial<
  Pick<
    TenantRegistryItem,
    | 'name'
    | 'quota'
    | 'inactive'
    | 'industryType'
    | 'industryCategoryTag'
    | 'businessKeywords'
    | 'leadScoringWords'
    | 'nodeWorkflowProgress'
    | 'deploymentRegion'
    | 'storageRegion'
    | 'dataResidency'
    | 'icpFilingStatus'
  >
>;

export async function listTenantRegistry(includeInactive = false): Promise<TenantRegistryItem[]> {
  const { data } = await api.get<{ code: number; data: { items: TenantRegistryItem[] } }>('/api/v1/tenant/registry', {
    params: includeInactive ? { includeInactive: 'true' } : undefined,
  });
  return data?.data?.items ?? [];
}

export async function createTenantRegistry(payload?: Partial<TenantRegistryItem>): Promise<TenantRegistryItem> {
  const { data } = await api.post<{ code: number; data: TenantRegistryItem }>('/api/v1/tenant/registry', payload ?? {});
  return data.data;
}

export async function updateTenantRegistry(
  tenantId: string,
  patch: TenantRegistryPatch,
): Promise<TenantRegistryItem> {
  const { data } = await api.patch<{ code: number; data: TenantRegistryItem }>(
    `/api/v1/tenant/registry/${encodeURIComponent(tenantId)}`,
    patch,
  );
  return data.data;
}

export async function archiveTenantRegistry(tenantId: string): Promise<TenantRegistryItem> {
  const { data } = await api.delete<{ code: number; data: TenantRegistryItem }>(
    `/api/v1/tenant/registry/${encodeURIComponent(tenantId)}`,
  );
  return data.data;
}
