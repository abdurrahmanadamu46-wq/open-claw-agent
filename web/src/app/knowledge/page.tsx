'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpenText, Brain, Database, Layers3, PlugZap, ShieldCheck } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { fetchControlPlaneKnowledgeOverview } from '@/services/endpoints/control-plane-overview';
import {
  getKnowledgeLayerTerms,
  type KnowledgeLayerKey,
} from '@/lib/knowledge-layer-language';

const LAYER_ICONS: Record<KnowledgeLayerKey, React.ReactNode> = {
  platform_generic: <ShieldCheck className="h-5 w-5" />,
  platform_industry: <BookOpenText className="h-5 w-5" />,
  tenant_private: <Layers3 className="h-5 w-5" />,
  role_activation: <Brain className="h-5 w-5" />,
  experience_memory: <Database className="h-5 w-5" />,
};

const OWNER_TONE: Record<string, string> = {
  platform: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
  tenant: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
  runtime: 'border-amber-400/25 bg-amber-400/10 text-amber-100',
};

export default function KnowledgeOverviewPage() {
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';
  const overviewQuery = useQuery({
    queryKey: ['knowledge-overview', tenantId],
    queryFn: () => fetchControlPlaneKnowledgeOverview({ tenant_id: tenantId }),
  });
  const summary = overviewQuery.data?.summary;
  const layerTerms = getKnowledgeLayerTerms();

  return (
    <div className="space-y-6 p-6 text-slate-100">
      <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
          <Database className="h-4 w-4" />
          知识区总览
        </div>
        <h1 className="mt-4 text-3xl font-semibold text-white md:text-4xl">
          把知识区统一成三层知识模型，再解释角色挂载和经验记忆
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
          前端以后统一用这套语言：平台通用知识、平台行业知识、租户私有知识。Prompt / RAG
          包是角色消费层，经验记忆层是运行时沉淀层。这样 demo、QA 和后端联调时，都能说清楚知识从哪里来、归谁所有、能被谁读取。
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard icon={<Layers3 className="h-4 w-4" />} label="租户知识库" value={String(summary?.knowledge_base_count ?? 0)} />
        <SummaryCard icon={<PlugZap className="h-4 w-4" />} label="运行时能力" value={`${Number(summary?.provider_count ?? 0)}/${Number(summary?.mcp_server_count ?? 0)}`} helper="providers / mcp" />
        <SummaryCard icon={<ShieldCheck className="h-4 w-4" />} label="连接凭证" value={String(summary?.connector_credential_count ?? 0)} />
        <SummaryCard icon={<Database className="h-4 w-4" />} label="经验记忆" value={`${Number(summary?.tenant_memory_total_entries ?? 0)}`} helper={`scope ${Number(summary?.tenant_memory_scope_count ?? 0)}`} />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {layerTerms.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 transition hover:border-cyan-400/25 hover:bg-white/[0.06]"
          >
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
              {LAYER_ICONS[item.key]}
            </div>
            <div className="mt-4 text-lg font-semibold text-white">{item.title}</div>
            <div className="mt-2 text-sm leading-7 text-slate-300">{item.description}</div>
            <div className={`mt-4 inline-flex rounded-full border px-3 py-1 text-xs ${OWNER_TONE[item.owner]}`}>
              {item.scopeLabel}
            </div>
          </Link>
        ))}
      </section>

      <section className="rounded-[28px] border border-white/10 bg-slate-950/35 p-5">
        <div className="text-lg font-semibold text-white">命名边界</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <BoundaryCard
            title="平台层不会被租户直接覆盖"
            detail="平台通用知识和平台行业知识都属于平台维护资产。租户内容如果要上流，必须经过显式整理和审核。"
          />
          <BoundaryCard
            title="租户私有知识必须带 tenant scope"
            detail="租户品牌文档、SOP、案例、私有语气和线索词，默认只属于当前租户，不能静默进入平台层。"
          />
          <BoundaryCard
            title="角色知识包只是消费层"
            detail="Prompt / RAG 包负责把知识挂到角色上，不等于新的知识归属层；它要解释自己读了哪一层。"
          />
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  helper,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
      {helper ? <div className="mt-1 text-xs text-slate-400">{helper}</div> : null}
    </div>
  );
}

function BoundaryCard({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-2 text-sm leading-7 text-slate-300">{detail}</div>
    </div>
  );
}
