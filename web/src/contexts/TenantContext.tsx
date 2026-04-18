'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { triggerErrorToast } from '@/services/api';
import { getCurrentUser } from '@/services/endpoints/user';
import {
  archiveTenantRegistry,
  createTenantRegistry,
  listTenantRegistry,
  type LeadScoringWords,
  type NodeWorkflowProgress,
  type TenantRegistryItem,
  type TenantRegistryPatch,
  updateTenantRegistry,
} from '@/services/endpoints/tenant';

export type IndustryType = string;
export type NodeWorkflowStepId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

export interface Tenant {
  id: string;
  name: string;
  quota: number;
  inactive?: boolean;
  industryType?: IndustryType;
  industryCategoryTag?: string;
  businessKeywords?: string[];
  leadScoringWords?: LeadScoringWords;
  nodeWorkflowProgress?: Partial<NodeWorkflowProgress>;
  deploymentRegion?: string;
  storageRegion?: string;
  dataResidency?: 'cn-mainland' | 'custom';
  icpFilingStatus?: 'pending' | 'ready' | 'submitted' | 'approved';
  createdAt?: string;
  updatedAt?: string;
}

const DEFAULT_WORKFLOW_PROGRESS: NodeWorkflowProgress = {
  S1: false,
  S2: false,
  S3: false,
  S4: false,
  S5: false,
};

const DEFAULT_LEAD_SCORING: LeadScoringWords = {
  highIntent: ['怎么买', '多少钱', '可以下单吗', '联系方式'],
  painPoints: ['成本高', '转化低', '复购差'],
};

const DEFAULT_INDUSTRY = '';
const DEFAULT_CATEGORY = '';
const CURRENT_TENANT_STORAGE_KEY = 'clawcommerce.currentTenantId.v1';

export const INITIAL_TENANTS: Tenant[] = [
  {
    id: 'tenant-main',
    name: '默认租户',
    quota: 5,
    industryType: DEFAULT_INDUSTRY,
    industryCategoryTag: DEFAULT_CATEGORY,
    businessKeywords: ['同城引流', '门店转化'],
    leadScoringWords: { ...DEFAULT_LEAD_SCORING },
    nodeWorkflowProgress: { S1: true, S2: false, S3: false, S4: false, S5: false },
    deploymentRegion: 'cn-shanghai',
    storageRegion: 'cn-shanghai',
    dataResidency: 'cn-mainland',
    icpFilingStatus: 'pending',
  },
];

function normalizeWorkflowProgress(progress?: Partial<NodeWorkflowProgress>): NodeWorkflowProgress {
  return {
    S1: !!progress?.S1,
    S2: !!progress?.S2,
    S3: !!progress?.S3,
    S4: !!progress?.S4,
    S5: !!progress?.S5,
  };
}

function mergeTenantWithDefaults(tenant: Tenant): Tenant {
  return {
    ...tenant,
    name: String(tenant.name || '未命名租户'),
    industryType: String(tenant.industryType || DEFAULT_INDUSTRY),
    industryCategoryTag: String(tenant.industryCategoryTag || DEFAULT_CATEGORY),
    leadScoringWords: tenant.leadScoringWords ?? { ...DEFAULT_LEAD_SCORING },
    businessKeywords: Array.isArray(tenant.businessKeywords) ? tenant.businessKeywords : [],
    nodeWorkflowProgress: normalizeWorkflowProgress(tenant.nodeWorkflowProgress),
    deploymentRegion: tenant.deploymentRegion || 'cn-shanghai',
    storageRegion: tenant.storageRegion || 'cn-shanghai',
    dataResidency: tenant.dataResidency || 'cn-mainland',
    icpFilingStatus: tenant.icpFilingStatus || 'pending',
  };
}

function sanitizeTenantList(tenants: Tenant[]): Tenant[] {
  const seen = new Set<string>();
  const output: Tenant[] = [];
  for (const raw of tenants) {
    const id = String(raw.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(mergeTenantWithDefaults(raw));
  }
  return output.length > 0 ? output : INITIAL_TENANTS.map(mergeTenantWithDefaults);
}

function mapRegistryItem(item: TenantRegistryItem): Tenant {
  return mergeTenantWithDefaults({
    id: item.id,
    name: item.name,
    quota: item.quota,
    inactive: item.inactive,
    industryType: item.industryType,
    industryCategoryTag: item.industryCategoryTag,
    businessKeywords: item.businessKeywords,
    leadScoringWords: item.leadScoringWords,
    nodeWorkflowProgress: item.nodeWorkflowProgress,
    deploymentRegion: item.deploymentRegion,
    storageRegion: item.storageRegion,
    dataResidency: item.dataResidency,
    icpFilingStatus: item.icpFilingStatus,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

type TenantUpdatePatch = Partial<
  Pick<
    Tenant,
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

type TenantContextValue = {
  currentTenantId: string;
  setCurrentTenantId: (id: string) => void;
  tenants: Tenant[];
  currentTenant: Tenant | undefined;
  isHydrated: boolean;
  refreshTenants: () => Promise<void>;
  updateTenant: (id: string, patch: TenantUpdatePatch) => void;
  addTenant: (tenant?: Partial<Pick<Tenant, 'name' | 'quota' | 'inactive'>>) => Promise<Tenant>;
  removeTenant: (id: string) => Promise<void>;
  getTenantWorkflowProgress: (tenantId: string) => NodeWorkflowProgress;
  setTenantWorkflowStep: (tenantId: string, step: NodeWorkflowStepId, completed: boolean) => void;
  resetTenantWorkflowProgress: (tenantId: string) => void;
};

const TenantContext = createContext<TenantContextValue | null>(null);

function toRegistryPatch(patch: TenantUpdatePatch): TenantRegistryPatch {
  const next: TenantRegistryPatch = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) next.name = patch.name;
  if (Object.prototype.hasOwnProperty.call(patch, 'quota')) next.quota = patch.quota;
  if (Object.prototype.hasOwnProperty.call(patch, 'inactive')) next.inactive = patch.inactive;
  if (Object.prototype.hasOwnProperty.call(patch, 'industryType')) next.industryType = patch.industryType;
  if (Object.prototype.hasOwnProperty.call(patch, 'industryCategoryTag')) next.industryCategoryTag = patch.industryCategoryTag;
  if (Object.prototype.hasOwnProperty.call(patch, 'businessKeywords')) next.businessKeywords = patch.businessKeywords;
  if (Object.prototype.hasOwnProperty.call(patch, 'leadScoringWords')) next.leadScoringWords = patch.leadScoringWords;
  if (Object.prototype.hasOwnProperty.call(patch, 'nodeWorkflowProgress')) {
    next.nodeWorkflowProgress = patch.nodeWorkflowProgress
      ? normalizeWorkflowProgress(patch.nodeWorkflowProgress)
      : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'deploymentRegion')) next.deploymentRegion = patch.deploymentRegion;
  if (Object.prototype.hasOwnProperty.call(patch, 'storageRegion')) next.storageRegion = patch.storageRegion;
  if (Object.prototype.hasOwnProperty.call(patch, 'dataResidency')) next.dataResidency = patch.dataResidency;
  if (Object.prototype.hasOwnProperty.call(patch, 'icpFilingStatus')) next.icpFilingStatus = patch.icpFilingStatus;
  return next;
}

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [currentTenantId, setCurrentTenantIdState] = useState<string>(INITIAL_TENANTS[0].id);
  const [tenants, setTenants] = useState<Tenant[]>(INITIAL_TENANTS.map(mergeTenantWithDefaults));
  const [isHydrated, setIsHydrated] = useState(false);

  const setCurrentTenantId = useCallback((id: string) => {
    const normalized = id.trim();
    setCurrentTenantIdState(normalized);
    if (typeof window !== 'undefined' && normalized) {
      window.localStorage.setItem(CURRENT_TENANT_STORAGE_KEY, normalized);
    }
  }, []);

  const refreshTenants = useCallback(async () => {
    if (typeof window === 'undefined') {
      setIsHydrated(true);
      return;
    }
    const token = window.localStorage.getItem('clawcommerce_token');
    const storedSelection = window.localStorage.getItem(CURRENT_TENANT_STORAGE_KEY)?.trim() ?? '';
    if (!token) {
      if (storedSelection) {
        setCurrentTenantIdState(storedSelection);
      }
      setIsHydrated(true);
      return;
    }

    try {
      const [user, remoteTenants] = await Promise.all([getCurrentUser(), listTenantRegistry()]);
      const fallbackTenant =
        user?.tenantId
          ? sanitizeTenantList([
              {
                id: user.tenantId,
                name: user.tenantName || user.tenantId,
                quota: 3,
              },
            ])
          : INITIAL_TENANTS.map(mergeTenantWithDefaults);
      const nextTenants = remoteTenants.length > 0
        ? sanitizeTenantList(remoteTenants.map(mapRegistryItem))
        : fallbackTenant;

      setTenants(nextTenants);
      const nextCurrentTenantId =
        nextTenants.find((item) => item.id === storedSelection)?.id ??
        nextTenants.find((item) => item.id === user?.tenantId)?.id ??
        nextTenants[0]?.id ??
        INITIAL_TENANTS[0].id;
      setCurrentTenantId(nextCurrentTenantId);
    } catch {
      // Keep local fallback and avoid breaking the control plane.
    } finally {
      setIsHydrated(true);
    }
  }, [setCurrentTenantId]);

  useEffect(() => {
    void refreshTenants();
  }, [refreshTenants]);

  useEffect(() => {
    if (tenants.length === 0) return;
    if (!tenants.some((item) => item.id === currentTenantId)) {
      setCurrentTenantId(tenants[0].id);
    }
  }, [tenants, currentTenantId, setCurrentTenantId]);

  const currentTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === currentTenantId),
    [tenants, currentTenantId],
  );

  const updateTenant = useCallback(
    (id: string, patch: TenantUpdatePatch) => {
      const nextPatch = toRegistryPatch(patch);
      setTenants((prev) =>
        prev.map((tenant) =>
          tenant.id === id
            ? mergeTenantWithDefaults({
                ...tenant,
                ...patch,
                nodeWorkflowProgress: patch.nodeWorkflowProgress
                  ? {
                      ...normalizeWorkflowProgress(tenant.nodeWorkflowProgress),
                      ...patch.nodeWorkflowProgress,
                    }
                  : tenant.nodeWorkflowProgress,
              })
            : tenant,
        ),
      );

      if (typeof window === 'undefined' || !window.localStorage.getItem('clawcommerce_token')) {
        return;
      }

      void updateTenantRegistry(id, nextPatch).catch((error) => {
        triggerErrorToast(error instanceof Error ? error.message : '租户同步失败');
        void refreshTenants();
      });
    },
    [refreshTenants],
  );

  const addTenant = useCallback(
    async (patch?: Partial<Pick<Tenant, 'name' | 'quota' | 'inactive'>>): Promise<Tenant> => {
      if (typeof window === 'undefined' || !window.localStorage.getItem('clawcommerce_token')) {
        const fallback = mergeTenantWithDefaults({
          id: `tenant-${Date.now()}`,
          name: patch?.name || `租户-${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
          quota: patch?.quota ?? 3,
          inactive: patch?.inactive ?? false,
        });
        setTenants((prev) => sanitizeTenantList([...prev, fallback]));
        setCurrentTenantId(fallback.id);
        return fallback;
      }

      const created = await createTenantRegistry({
        name: patch?.name || `租户-${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
        quota: patch?.quota ?? 3,
        inactive: patch?.inactive ?? false,
      });
      const next = mapRegistryItem(created);
      setTenants((prev) => sanitizeTenantList([...prev, next]));
      setCurrentTenantId(next.id);
      return next;
    },
    [setCurrentTenantId],
  );

  const removeTenant = useCallback(
    async (id: string) => {
      if (typeof window !== 'undefined' && window.localStorage.getItem('clawcommerce_token')) {
        await archiveTenantRegistry(id);
      }
      setTenants((prev) => prev.filter((tenant) => tenant.id !== id));
      setCurrentTenantIdState((current) => (current === id ? '' : current));
    },
    [],
  );

  const getTenantWorkflowProgress = useCallback(
    (tenantId: string): NodeWorkflowProgress => {
      const target = tenants.find((tenant) => tenant.id === tenantId);
      return normalizeWorkflowProgress(target?.nodeWorkflowProgress);
    },
    [tenants],
  );

  const setTenantWorkflowStep = useCallback(
    (tenantId: string, step: NodeWorkflowStepId, completed: boolean) => {
      const target = tenants.find((tenant) => tenant.id === tenantId);
      const merged = {
        ...normalizeWorkflowProgress(target?.nodeWorkflowProgress),
        [step]: completed,
      };
      updateTenant(tenantId, { nodeWorkflowProgress: merged });
    },
    [tenants, updateTenant],
  );

  const resetTenantWorkflowProgress = useCallback(
    (tenantId: string) => {
      updateTenant(tenantId, { nodeWorkflowProgress: { ...DEFAULT_WORKFLOW_PROGRESS } });
    },
    [updateTenant],
  );

  return (
    <TenantContext.Provider
      value={{
        currentTenantId,
        setCurrentTenantId,
        tenants,
        currentTenant,
        isHydrated,
        refreshTenants,
        updateTenant,
        addTenant,
        removeTenant,
        getTenantWorkflowProgress,
        setTenantWorkflowStep,
        resetTenantWorkflowProgress,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return ctx;
}

export { DEFAULT_WORKFLOW_PROGRESS };
