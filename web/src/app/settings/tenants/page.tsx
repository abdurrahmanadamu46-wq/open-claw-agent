'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  ChevronUp,
  Plus,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { DangerActionGuard } from '@/components/DangerActionGuard';
import { useTenant, type Tenant } from '@/contexts/TenantContext';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import { getCurrentUser } from '@/services/endpoints/user';
import { INDUSTRY_TAXONOMY, findSubIndustryByTag, flattenSubIndustries } from '@/lib/industry-taxonomy';

const BG = '#0F172A';
const CARD_BG = 'rgba(30,41,59,0.72)';
const BORDER = 'rgba(71,85,105,0.45)';
const MUTED = '#94A3B8';
const TITLE = '#F8FAFC';
const GOLD = '#E5A93D';

const SUB_INDUSTRIES = flattenSubIndustries();

type TenantDraft = {
  name: string;
  quota: number;
  inactive: boolean;
  industryType: string;
  industryCategoryTag: string;
  businessKeywords: string;
  deploymentRegion: string;
  storageRegion: string;
  dataResidency: 'cn-mainland' | 'custom';
  icpFilingStatus: 'pending' | 'ready' | 'submitted' | 'approved';
};

function toDraft(tenant: Tenant): TenantDraft {
  return {
    name: tenant.name,
    quota: tenant.quota,
    inactive: !!tenant.inactive,
    industryType: tenant.industryType || '',
    industryCategoryTag: tenant.industryCategoryTag || INDUSTRY_TAXONOMY[0]?.category_tag || '',
    businessKeywords: (tenant.businessKeywords || []).join(', '),
    deploymentRegion: tenant.deploymentRegion || 'cn-shanghai',
    storageRegion: tenant.storageRegion || 'cn-shanghai',
    dataResidency: tenant.dataResidency || 'cn-mainland',
    icpFilingStatus: tenant.icpFilingStatus || 'pending',
  };
}

export default function TenantsSettingsPage() {
  const { tenants, addTenant, removeTenant, updateTenant, isHydrated } = useTenant();
  const { data: currentUser } = useQuery({
    queryKey: ['settings', 'tenants', 'current-user'],
    queryFn: getCurrentUser,
    staleTime: 5 * 60 * 1000,
  });
  const [search, setSearch] = useState('');
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TenantDraft>>({});
  const [busyTenantId, setBusyTenantId] = useState<string | null>(null);

  const isAdmin = currentUser?.isAdmin === true;

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const tenant of tenants) {
        next[tenant.id] = prev[tenant.id] ?? toDraft(tenant);
      }
      for (const id of Object.keys(next)) {
        if (!tenants.some((tenant) => tenant.id === id)) {
          delete next[id];
        }
      }
      return next;
    });
  }, [tenants]);

  const filteredTenants = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return tenants;
    return tenants.filter((tenant) =>
      [
        tenant.name,
        tenant.id,
        tenant.industryType,
        tenant.industryCategoryTag,
        tenant.deploymentRegion,
        tenant.storageRegion,
        ...(tenant.businessKeywords || []),
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }, [search, tenants]);

  async function handleCreateTenant() {
    try {
      setBusyTenantId('create');
      const tenant = await addTenant();
      setEditingTenantId(tenant.id);
      triggerSuccessToast(`已创建租户 ${tenant.name}`);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '创建租户失败');
    } finally {
      setBusyTenantId(null);
    }
  }

  async function handleArchiveTenant(tenantId: string) {
    try {
      setBusyTenantId(tenantId);
      await removeTenant(tenantId);
      triggerSuccessToast(`已归档租户 ${tenantId}`);
      if (editingTenantId === tenantId) {
        setEditingTenantId(null);
      }
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '归档租户失败');
    } finally {
      setBusyTenantId(null);
    }
  }

  function handleSaveTenant(tenant: Tenant) {
    const draft = drafts[tenant.id];
    if (!draft) return;
    updateTenant(tenant.id, {
      name: draft.name.trim() || tenant.name,
      quota: draft.quota,
      inactive: draft.inactive,
      industryType: draft.industryType,
      industryCategoryTag: draft.industryCategoryTag,
      businessKeywords: draft.businessKeywords
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      deploymentRegion: draft.deploymentRegion,
      storageRegion: draft.storageRegion,
      dataResidency: draft.dataResidency,
      icpFilingStatus: draft.icpFilingStatus,
    });
    triggerSuccessToast(`已保存租户 ${draft.name || tenant.id}`);
  }

  if (!isHydrated) {
    return <div className="py-20 text-center text-slate-400">正在同步租户注册表...</div>;
  }

  return (
    <div className="min-h-[calc(100vh-5rem)] p-6" style={{ backgroundColor: BG }}>
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-2xl border px-6 py-5" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
          <div className="mb-4 flex items-center gap-4">
            <Link href="/fleet" className="inline-flex items-center gap-2 text-sm hover:opacity-90" style={{ color: MUTED }}>
              <ArrowLeft className="h-4 w-4" />
              返回边缘算力池
            </Link>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Building2 className="h-6 w-6" style={{ color: GOLD }} />
              <div>
                <h1 className="text-2xl font-semibold" style={{ color: TITLE }}>租户注册表</h1>
                <p className="mt-1 text-sm" style={{ color: MUTED }}>
                  这里是控制面真实的租户源，不再依赖浏览器本地存储。行业标签、部署地域和 ICP 状态会直接影响后续商业化交付。
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleCreateTenant()}
              disabled={busyTenantId === 'create' || !isAdmin}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: GOLD, color: '#0F172A' }}
            >
              <Plus className="h-4 w-4" />
              新增租户
            </button>
          </div>
        </section>

        <section className="rounded-2xl border p-4" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold" style={{ color: TITLE }}>租户列表</h2>
            <label className="relative block w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"
                style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.85)', color: TITLE }}
                placeholder="搜索租户 / 行业 / 关键词"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          {filteredTenants.length === 0 ? (
            <p className="text-sm" style={{ color: MUTED }}>没有匹配的租户。</p>
          ) : (
            <div className="space-y-2">
              {filteredTenants.map((tenant) => {
                const expanded = editingTenantId === tenant.id;
                const industry = findSubIndustryByTag(tenant.industryType);
                const keywords = tenant.businessKeywords || [];
                const draft = drafts[tenant.id] ?? toDraft(tenant);
                const subIndustryOptions = SUB_INDUSTRIES.filter(
                  (item) => !draft.industryCategoryTag || item.category_tag === draft.industryCategoryTag,
                );

                return (
                  <div key={tenant.id} className="rounded-xl border" style={{ borderColor: BORDER, backgroundColor: 'rgba(2,6,23,0.5)' }}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-3 text-left"
                      onClick={() => setEditingTenantId(expanded ? null : tenant.id)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold" style={{ color: TITLE }}>
                          {tenant.name}
                          <span className="ml-2 text-xs font-normal" style={{ color: MUTED }}>
                            ({tenant.id})
                          </span>
                        </div>
                        <div className="mt-1 text-xs" style={{ color: MUTED }}>
                          {tenant.inactive ? '已停用' : '已启用'} · 配额 {tenant.quota} · 行业 {industry?.name || '未设置'} · 地域 {tenant.deploymentRegion || 'cn-shanghai'} · ICP {tenant.icpFilingStatus || 'pending'}
                        </div>
                        <div className="mt-1 text-xs" style={{ color: MUTED }}>
                          关键词：{keywords.length > 0 ? keywords.join('、') : '未设置'}
                        </div>
                      </div>
                      {expanded ? <ChevronUp className="h-4 w-4 text-slate-300" /> : <ChevronDown className="h-4 w-4 text-slate-300" />}
                    </button>

                    {expanded ? (
                      <div className="space-y-3 border-t px-3 pb-3 pt-3" style={{ borderColor: BORDER }}>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="text-sm" style={{ color: MUTED }}>
                            租户名称
                            <input
                              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                              style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.85)', color: TITLE }}
                              value={draft.name}
                              onChange={(event) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [tenant.id]: { ...draft, name: event.target.value },
                                }))
                              }
                            />
                          </label>
                          <label className="text-sm" style={{ color: MUTED }}>
                            节点配额
                            <input
                              type="number"
                              min={0}
                              disabled={!isAdmin}
                              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
                              style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.85)', color: TITLE }}
                              value={draft.quota}
                              onChange={(event) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [tenant.id]: {
                                    ...draft,
                                    quota: Math.max(0, Number(event.target.value) || 0),
                                  },
                                }))
                              }
                            />
                          </label>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="text-sm" style={{ color: MUTED }}>
                            所属大类
                            <select
                              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                              style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.85)', color: TITLE }}
                              value={draft.industryCategoryTag}
                              onChange={(event) => {
                                const categoryTag = event.target.value;
                                const category = INDUSTRY_TAXONOMY.find((item) => item.category_tag === categoryTag);
                                const nextSub = category?.sub_industries[0];
                                setDrafts((prev) => ({
                                  ...prev,
                                  [tenant.id]: {
                                    ...draft,
                                    industryCategoryTag: categoryTag,
                                    industryType: nextSub?.tag || '',
                                  },
                                }));
                              }}
                            >
                              {INDUSTRY_TAXONOMY.map((item) => (
                                <option key={item.category_tag} value={item.category_tag}>
                                  {item.category_name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="text-sm" style={{ color: MUTED }}>
                            细分行业
                            <select
                              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                              style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.85)', color: TITLE }}
                              value={draft.industryType}
                              onChange={(event) => {
                                const subTag = event.target.value;
                                const sub = findSubIndustryByTag(subTag);
                                setDrafts((prev) => ({
                                  ...prev,
                                  [tenant.id]: {
                                    ...draft,
                                    industryType: subTag,
                                    industryCategoryTag: sub?.category_tag || draft.industryCategoryTag,
                                  },
                                }));
                              }}
                            >
                              {subIndustryOptions.map((item) => (
                                <option key={item.tag} value={item.tag}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="text-sm" style={{ color: MUTED }}>
                            行业关键词（逗号分隔）
                            <input
                              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                              style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.85)', color: TITLE }}
                              value={draft.businessKeywords}
                              onChange={(event) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [tenant.id]: { ...draft, businessKeywords: event.target.value },
                                }))
                              }
                            />
                          </label>

                          <label className="inline-flex items-center gap-2 self-end text-sm" style={{ color: MUTED }}>
                            <input
                              type="checkbox"
                              checked={!draft.inactive}
                              disabled={!isAdmin}
                              onChange={(event) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [tenant.id]: { ...draft, inactive: !event.target.checked },
                                }))
                              }
                            />
                            已启用
                          </label>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <label className="text-sm" style={{ color: MUTED }}>
                            部署地域
                            <input
                              disabled={!isAdmin}
                              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
                              style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.85)', color: TITLE }}
                              value={draft.deploymentRegion}
                              onChange={(event) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [tenant.id]: { ...draft, deploymentRegion: event.target.value },
                                }))
                              }
                            />
                          </label>
                          <label className="text-sm" style={{ color: MUTED }}>
                            存储地域
                            <input
                              disabled={!isAdmin}
                              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
                              style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.85)', color: TITLE }}
                              value={draft.storageRegion}
                              onChange={(event) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [tenant.id]: { ...draft, storageRegion: event.target.value },
                                }))
                              }
                            />
                          </label>
                          <label className="text-sm" style={{ color: MUTED }}>
                            数据驻留
                            <select
                              disabled={!isAdmin}
                              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
                              style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.85)', color: TITLE }}
                              value={draft.dataResidency}
                              onChange={(event) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [tenant.id]: {
                                    ...draft,
                                    dataResidency: event.target.value as 'cn-mainland' | 'custom',
                                  },
                                }))
                              }
                            >
                              <option value="cn-mainland">中国大陆</option>
                              <option value="custom">自定义</option>
                            </select>
                          </label>
                          <label className="text-sm" style={{ color: MUTED }}>
                            ICP 状态
                            <select
                              disabled={!isAdmin}
                              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
                              style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.85)', color: TITLE }}
                              value={draft.icpFilingStatus}
                              onChange={(event) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [tenant.id]: {
                                    ...draft,
                                    icpFilingStatus: event.target.value as TenantDraft['icpFilingStatus'],
                                  },
                                }))
                              }
                            >
                              <option value="pending">pending</option>
                              <option value="ready">ready</option>
                              <option value="submitted">submitted</option>
                              <option value="approved">approved</option>
                            </select>
                          </label>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleSaveTenant(tenant)}
                            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm"
                            style={{ borderColor: 'rgba(56,189,248,0.45)', color: '#BAE6FD' }}
                          >
                            <Save className="h-4 w-4" />
                            保存
                          </button>
                          <DangerActionGuard
                            trigger={
                              <button
                                type="button"
                                disabled={!isAdmin || busyTenantId === tenant.id}
                                className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
                                style={{ borderColor: '#EF4444', color: '#FCA5A5' }}
                              >
                                <Trash2 className="h-4 w-4" />
                                归档
                              </button>
                            }
                            title={`归档租户：${tenant.name}`}
                            description="归档后该租户将从活跃租户列表中移除，后续租户切换与默认视图都会失去它。"
                            affectedCount={tenant.quota}
                            affectedType="节点配额位"
                            confirmText="ARCHIVE"
                            confirmLabel="确认归档"
                            successMessage={`已归档租户 ${tenant.id}`}
                            onConfirm={async () => {
                              await handleArchiveTenant(tenant.id);
                            }}
                            disabled={!isAdmin || busyTenantId === tenant.id}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
