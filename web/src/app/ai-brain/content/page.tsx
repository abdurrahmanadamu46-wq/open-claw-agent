'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/contexts/TenantContext';
import { fetchAiSkillsPoolOverview } from '@/services/endpoints/ai-subservice';
import { fetchIntegrations } from '@/services/endpoints/integrations';

function normalizeText(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || '-';
}

function fieldLabel(value: string): string {
  switch (value) {
    case 'general':
      return '通用';
    default:
      return value;
  }
}

export default function AiContentPage() {
  const { currentTenantId } = useTenant();

  const skillsQuery = useQuery({
    queryKey: ['ai-skills-overview-content', currentTenantId],
    queryFn: () => fetchAiSkillsPoolOverview(currentTenantId),
  });

  const integrationsQuery = useQuery({
    queryKey: ['integrations-content', currentTenantId],
    queryFn: fetchIntegrations,
  });

  const workflowTemplates = useMemo(() => {
    return (skillsQuery.data?.overview?.workflow_templates || []) as Array<Record<string, unknown>>;
  }, [skillsQuery.data]);

  const storage = integrationsQuery.data?.storage;
  const storageEnabled = Boolean(storage?.provider && storage?.bucketName);

  return (
    <div className="min-h-0 space-y-6 p-4 md:p-6" style={{ backgroundColor: '#0F172A' }}>
      <div>
        <h1 className="text-xl font-semibold text-slate-100">内容模板与素材配置</h1>
        <p className="mt-1 text-sm text-slate-400">
          这里只展示后端真实返回的模板与对象存储配置，不再展示本地伪数据。
        </p>
      </div>

      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/70">
        <div className="border-b border-slate-700/60 px-4 py-3 text-sm font-medium text-slate-100">
          工作流模板
        </div>
        <div className="p-4">
          {skillsQuery.isLoading ? (
            <div className="text-sm text-slate-400">加载中...</div>
          ) : skillsQuery.isError ? (
            <div className="text-sm text-rose-300">读取失败，请检查后端服务。</div>
          ) : workflowTemplates.length === 0 ? (
            <div className="text-sm text-slate-500">
              暂无模板，请先在龙虾技能池里配置工作流模板。
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {workflowTemplates.map((tpl, idx) => {
                const name = normalizeText(tpl.template_name ?? tpl.name ?? `template-${idx + 1}`);
                const industry = fieldLabel(normalizeText(tpl.industry_tag ?? tpl.industry ?? 'general'));
                const version = normalizeText(tpl.version ?? tpl.template_version ?? '-');
                const updatedAt = normalizeText(tpl.updated_at ?? tpl.created_at ?? '-');
                return (
                  <article
                    key={`${name}-${idx}`}
                    className="rounded-xl border border-slate-700 bg-slate-950/50 p-3"
                  >
                    <h3 className="text-sm font-semibold text-slate-100">{name}</h3>
                    <div className="mt-2 space-y-1 text-xs text-slate-400">
                      <div>
                        行业：<span className="text-slate-200">{industry}</span>
                      </div>
                      <div>
                        版本：<span className="text-slate-200">{version}</span>
                      </div>
                      <div>
                        更新时间：<span className="text-slate-300">{updatedAt}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/70">
        <div className="border-b border-slate-700/60 px-4 py-3 text-sm font-medium text-slate-100">
          对象存储配置
        </div>
        <div className="p-4">
          {integrationsQuery.isLoading ? (
            <div className="text-sm text-slate-400">加载中...</div>
          ) : integrationsQuery.isError ? (
            <div className="text-sm text-rose-300">读取失败，请检查租户集成配置。</div>
          ) : !storage ? (
            <div className="text-sm text-slate-500">当前租户未配置对象存储。</div>
          ) : (
            <div className="space-y-1 text-sm text-slate-300">
              <div>
                启用状态：
                <span className={storageEnabled ? 'text-emerald-300' : 'text-slate-400'}>
                  {storageEnabled ? '已启用' : '未启用'}
                </span>
              </div>
              <div>
                存储服务：<span className="text-slate-100">{normalizeText(storage.provider)}</span>
              </div>
              <div>
                存储桶：<span className="text-slate-100">{normalizeText(storage.bucketName)}</span>
              </div>
              <div>
                区域：<span className="text-slate-100">{normalizeText(storage.region)}</span>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
