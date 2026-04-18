'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BookOpenText, Brain, Database, Layers3 } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import {
  bindKnowledgeBase,
  createKnowledgeBase,
  fetchKnowledgeBaseDetail,
  fetchKnowledgeBases,
  searchKnowledgeBase,
  uploadKnowledgeBaseDocument,
} from '@/services/endpoints/ai-subservice';
import {
  fetchControlPlaneTenantPrivateKnowledgeSummaries,
} from '@/services/endpoints/control-plane-overview';
import { getKnowledgeLayerTerm, getKnowledgeLayerTerms } from '@/lib/knowledge-layer-language';
import type { KnowledgeBaseDetail, KnowledgeBaseSearchHit, KnowledgeBaseSummary } from '@/types/knowledge-base';
import type { ControlPlaneCollabSummaryEntry } from '@/types/control-plane-overview';

const LOBSTERS = ['commander', 'radar', 'strategist', 'inkwriter', 'visualizer', 'dispatcher', 'echoer', 'catcher', 'abacus', 'followup'];
const KNOWLEDGE_LAYER_ICONS: Record<string, ReactNode> = {
  platform_generic: <Database className="h-5 w-5 text-slate-300" />,
  platform_industry: <BookOpenText className="h-5 w-5 text-cyan-300" />,
  tenant_private: <Layers3 className="h-5 w-5 text-emerald-300" />,
  role_activation: <Brain className="h-5 w-5 text-fuchsia-300" />,
  experience_memory: <Database className="h-5 w-5 text-amber-300" />,
};

export default function KnowledgeBasePage() {
  const { currentTenantId } = useTenant();
  const tenantId = currentTenantId || 'tenant_main';
  const [items, setItems] = useState<KnowledgeBaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<KnowledgeBaseDetail | null>(null);
  const [searchHits, setSearchHits] = useState<KnowledgeBaseSearchHit[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [uploadText, setUploadText] = useState('');
  const [bindLobsterId, setBindLobsterId] = useState('radar');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [collabSummaries, setCollabSummaries] = useState<ControlPlaneCollabSummaryEntry[]>([]);
  const [collabSummaryLoading, setCollabSummaryLoading] = useState(false);

  const loadList = async () => {
    setLoading(true);
    try {
      const data = await fetchKnowledgeBases();
      const next = data.items ?? [];
      setItems(next);
      if (!selectedId && next.length > 0) {
        setSelectedId(next[0].kb_id);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (kbId: string) => {
    const data = await fetchKnowledgeBaseDetail(kbId);
    setDetail(data.kb);
  };

  const loadCollabSummaries = async () => {
    setCollabSummaryLoading(true);
    try {
      const data = await fetchControlPlaneTenantPrivateKnowledgeSummaries({ tenant_id: tenantId, limit: 6 });
      setCollabSummaries(data.items ?? []);
    } finally {
      setCollabSummaryLoading(false);
    }
  };

  useEffect(() => {
    void loadList();
    void loadCollabSummaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetail(selectedId);
  }, [selectedId]);

  const handleCreate = async () => {
    if (!nameDraft.trim()) return;
    const data = await createKnowledgeBase({ name: nameDraft.trim() });
    setNameDraft('');
    setFeedback('知识库已创建');
    await loadList();
    setSelectedId(data.kb.kb_id);
  };

  const handleUpload = async () => {
    if (!selectedId || !uploadName.trim() || !uploadText.trim()) return;
    await uploadKnowledgeBaseDocument({ kb_id: selectedId, filename: uploadName.trim(), text: uploadText.trim() });
    setFeedback('文档已上传并完成分块');
    setUploadName('');
    setUploadText('');
    await loadDetail(selectedId);
    await loadList();
  };

  const handleBind = async () => {
    if (!selectedId || !bindLobsterId) return;
    await bindKnowledgeBase({ kb_id: selectedId, lobster_id: bindLobsterId });
    setFeedback(`已绑定到 ${bindLobsterId}`);
    await loadDetail(selectedId);
    await loadList();
  };

  const handleSearch = async () => {
    if (!selectedId || !searchDraft.trim()) return;
    const data = await searchKnowledgeBase(selectedId, searchDraft.trim(), 5);
    setSearchHits(data.items ?? []);
  };

  const stats = useMemo(() => ({
    total: items.length,
    docs: items.reduce((sum, item) => sum + Number(item.doc_count || 0), 0),
  }), [items]);
  const boundLobsters = detail?.bound_lobsters ?? [];
  const tenantKnowledgeTerm = getKnowledgeLayerTerm('tenant_private');
  const layerLinks = getKnowledgeLayerTerms();

  return (
    <div className="p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
            <Layers3 className="h-4 w-4" />
            {tenantKnowledgeTerm.title}
          </div>
          <h1 className="mt-4 text-3xl font-semibold text-white md:text-4xl">把“租户私有知识”从平台知识和经验记忆里明确剥离出来</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
            当前页属于 {tenantKnowledgeTerm.scopeLabel}。它只管理租户自己的品牌文档、SOP、案例和私有资料；平台行业知识、角色挂载知识包和经验记忆层是并列层，不应该混在这里。
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {layerLinks.filter((item) => item.key !== 'platform_generic').map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-[24px] border p-4 transition ${
                item.href === '/operations/knowledge-base'
                  ? 'border-cyan-400/35 bg-cyan-400/10'
                  : 'border-white/10 bg-white/[0.04] hover:border-cyan-400/25 hover:bg-white/[0.06]'
              }`}
            >
              <div className="flex items-center gap-2 text-sm text-slate-100">
                {KNOWLEDGE_LAYER_ICONS[item.key]}
                <span className="font-medium">{item.title}</span>
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-300">{item.description}</div>
              <div className="mt-3 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
                {item.scopeLabel}
              </div>
            </Link>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="rounded-[28px] border border-white/10 bg-[#0c1628] p-5">
          <div className="text-xs uppercase tracking-[0.3em] text-cyan-300">Knowledge Base</div>
          <h1 className="mt-2 text-2xl font-semibold text-white">龙虾知识库</h1>
          <p className="mt-1 text-sm text-slate-300">把文档、手册、SOP 和品牌知识绑定给龙虾，在执行时自动注入可检索上下文。</p>
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
            <div>知识库总数：{stats.total}</div>
            <div className="mt-1">文档总数：{stats.docs}</div>
          </div>
          <div className="mt-4 space-y-2">
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="新知识库名称"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
            />
            <button type="button" onClick={() => void handleCreate()} className="w-full rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100">
              创建知识库
            </button>
          </div>
          <div className="mt-5 space-y-2">
            {items.map((item) => (
              <button
                key={item.kb_id}
                type="button"
                onClick={() => setSelectedId(item.kb_id)}
                className={`w-full rounded-2xl border px-4 py-3 text-left ${selectedId === item.kb_id ? 'border-cyan-300/70 bg-cyan-500/10' : 'border-slate-700 bg-slate-900 hover:border-slate-500'}`}
              >
                <div className="text-sm font-semibold text-white">{item.name}</div>
                <div className="mt-1 text-xs text-slate-400">文档 {item.doc_count} · 绑定 {item.bound_lobsters.length}</div>
              </button>
            ))}
            {loading && <div className="text-sm text-slate-400">正在加载知识库...</div>}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-[#0c1525] p-5">
            <h2 className="text-lg font-semibold text-white">{detail?.name || '请选择知识库'}</h2>
            <div className="mt-2 text-xs text-slate-400">已绑定龙虾：{detail?.bound_lobsters?.join(', ') || '暂无'}</div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                <div className="text-sm font-semibold text-white">上传文档</div>
                <input
                  value={uploadName}
                  onChange={(event) => setUploadName(event.target.value)}
                  placeholder="文件名，例如 brand-handbook.txt"
                  className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                />
                <textarea
                  value={uploadText}
                  onChange={(event) => setUploadText(event.target.value)}
                  rows={8}
                  placeholder="粘贴文档正文"
                  className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                />
                <button type="button" onClick={() => void handleUpload()} className="mt-3 rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100">
                  上传并分块
                </button>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                <div className="text-sm font-semibold text-white">绑定龙虾</div>
                <select value={bindLobsterId} onChange={(event) => setBindLobsterId(event.target.value)} className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white">
                  {LOBSTERS.map((lobsterId) => <option key={lobsterId} value={lobsterId}>{lobsterId}</option>)}
                </select>
                <button type="button" onClick={() => void handleBind()} className="mt-3 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">
                  绑定到龙虾
                </button>

                <div className="mt-6 text-sm font-semibold text-white">检索测试</div>
                <input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="输入查询词，例如 品牌语气"
                  className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white"
                />
                <button type="button" onClick={() => void handleSearch()} className="mt-3 rounded-2xl border border-violet-400/40 bg-violet-400/10 px-4 py-2 text-sm text-violet-100">
                  搜索知识库
                </button>
              </div>
            </div>
            {feedback ? <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{feedback}</div> : null}
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#0c1525] p-5">
            <h2 className="text-lg font-semibold text-white">文档列表</h2>
            <div className="mt-3 space-y-2">
              {detail?.documents?.length ? detail.documents.map((doc) => (
                <div key={doc.doc_id} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-200">
                  <div className="font-medium text-white">{doc.filename}</div>
                  <div className="mt-1 text-xs text-slate-400">chunk_count: {doc.chunk_count} · {doc.created_at}</div>
                </div>
              )) : <div className="text-sm text-slate-400">暂无文档。</div>}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#0c1525] p-5">
            <h2 className="text-lg font-semibold text-white">搜索结果</h2>
            <div className="mt-3 space-y-3">
              {searchHits.length ? searchHits.map((hit) => (
                <div key={hit.chunk_id} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                  <div className="text-xs text-slate-400">score {hit.score} · chunk {hit.chunk_index}</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{hit.content}</div>
                </div>
              )) : <div className="text-sm text-slate-400">输入查询后会在这里显示匹配片段。</div>}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#0c1525] p-5">
            <h2 className="text-lg font-semibold text-white">Tenant-private collaboration summaries</h2>
            <div className="mt-2 text-sm leading-7 text-slate-300">
              This panel is the closeout proof for the knowledge boundary: raw collaboration traces stay in audit,
              and only de-identified tenant-private summaries are exposed here for downstream supervisor/task use.
            </div>
            <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-xs text-slate-400">
              <div>Current consumer candidates: {boundLobsters.length ? boundLobsters.join(', ') : 'bind a lobster to the selected tenant KB first'}</div>
              <div className="mt-1">Source layer is fixed to tenant_private. Platform layers must not display raw collaboration records.</div>
            </div>
            <div className="mt-4 space-y-3">
              {collabSummaryLoading ? (
                <div className="text-sm text-slate-400">Loading collaboration summaries...</div>
              ) : collabSummaries.length ? collabSummaries.map((item) => (
                <div key={item.captureId} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{item.sourceType}</div>
                    <div className="text-xs text-slate-400">{item.objectType} · {item.createdAt}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-200">{item.insight}</div>
                  <div className="mt-3 text-xs text-slate-400">
                    evidence refs: {item.evidenceRefs.map((ref) => ref.recordId).join(', ') || 'none'}
                  </div>
                </div>
              )) : (
                <div className="text-sm text-slate-400">No tenant-private collaboration summaries yet.</div>
              )}
            </div>
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}
