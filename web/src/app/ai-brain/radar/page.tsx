'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTenant } from '@/contexts/TenantContext';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import {
  analyzeAndStoreCompetitiveIntel,
  fetchCompetitiveFormulaLibrary,
  type CompetitivePlatform,
} from '@/services/endpoints/rag-intel';

type TrendPoint = { date: string; count: number };

const BORDER = 'rgba(71,85,105,0.4)';

function toDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

function industryLabel(value?: string): string {
  if (!value) return '通用';
  return value === 'general' ? '通用' : value;
}

export default function CompetitorRadarPage() {
  const { currentTenant } = useTenant();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    platform: 'douyin' as CompetitivePlatform,
    postUrl: '',
    title: '',
    hook: '',
    cta: '',
  });

  const libraryQuery = useQuery({
    queryKey: ['competitive-formula-library'],
    queryFn: () => fetchCompetitiveFormulaLibrary({ limit: 100 }),
  });

  const libraryItems = useMemo(
    () => (Array.isArray(libraryQuery.data) ? libraryQuery.data : []),
    [libraryQuery.data],
  );

  const trendData = useMemo<TrendPoint[]>(() => {
    const map = new Map<string, number>();
    for (const item of libraryItems) {
      const key = toDateLabel(item.extractedAt);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [libraryItems]);

  const handleAnalyze = async () => {
    if (!form.postUrl.trim()) {
      triggerErrorToast('请输入对标链接');
      return;
    }
    setSubmitting(true);
    try {
      const result = await analyzeAndStoreCompetitiveIntel({
        source: {
          platform: form.platform,
          postUrl: form.postUrl.trim(),
          accountName: 'manual_input',
        },
        classification: {
          industry: currentTenant?.industryType ?? 'general',
          niche: currentTenant?.businessKeywords?.[0] ?? 'general',
          scenario: 'competitor_breakdown',
        },
        sample: {
          title: form.title.trim() || undefined,
          hook: form.hook.trim() || undefined,
          cta: form.cta.trim() || undefined,
          transcript: [form.title.trim(), form.hook.trim(), form.cta.trim()].filter(Boolean).join(' | ') || undefined,
          comments: [],
        },
        upsertAsCorpus: true,
      });
      triggerSuccessToast(`拆解成功并入库：${result.formula.id}`);
      await libraryQuery.refetch();
      setForm((prev) => ({ ...prev, postUrl: '', title: '', hook: '', cta: '' }));
    } catch (error) {
      triggerErrorToast(`拆解失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-6rem)] p-6" style={{ backgroundColor: '#0F172A' }}>
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">竞品雷达 · 真实拆解入库</h1>
          <p className="mt-1 text-sm text-slate-400">
            仅使用后端真实数据：手动输入对标链接，触发拆解并沉淀到 RAG 公式库。
          </p>
        </div>

        <Card style={{ borderColor: 'rgba(229,169,61,0.3)' }}>
          <CardHeader>
            <CardTitle className="text-base text-amber-300">手动触发拆解</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-slate-400">平台</span>
                <select
                  value={form.platform}
                  onChange={(e) => setForm((prev) => ({ ...prev, platform: e.target.value as CompetitivePlatform }))}
                  className="w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  style={{ borderColor: BORDER }}
                >
                  <option value="douyin">抖音</option>
                  <option value="xiaohongshu">小红书</option>
                  <option value="kuaishou">快手</option>
                  <option value="bilibili">B站</option>
                  <option value="wechat">微信视频号</option>
                  <option value="other">其他</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-400">行业标签</span>
                <input
                  value={industryLabel(currentTenant?.industryType)}
                  readOnly
                  className="w-full rounded-lg border bg-slate-800 px-3 py-2 text-sm text-slate-300"
                  style={{ borderColor: BORDER }}
                />
              </label>
            </div>
            <label className="space-y-1">
              <span className="text-xs text-slate-400">对标链接（必填）</span>
              <input
                value={form.postUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, postUrl: e.target.value }))}
                placeholder="https://..."
                className="w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm text-slate-100"
                style={{ borderColor: BORDER }}
              />
            </label>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs text-slate-400">标题</span>
                <input
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  style={{ borderColor: BORDER }}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-400">开场钩子</span>
                <input
                  value={form.hook}
                  onChange={(e) => setForm((prev) => ({ ...prev, hook: e.target.value }))}
                  className="w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  style={{ borderColor: BORDER }}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-400">CTA</span>
                <input
                  value={form.cta}
                  onChange={(e) => setForm((prev) => ({ ...prev, cta: e.target.value }))}
                  className="w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  style={{ borderColor: BORDER }}
                />
              </label>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => void handleAnalyze()} disabled={submitting}>
                {submitting ? '拆解中...' : '开始拆解并入库'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-slate-100">近期开采趋势（真实入库）</CardTitle>
          </CardHeader>
          <CardContent>
            {trendData.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">暂无入库趋势数据</div>
            ) : (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fillUv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#E5A93D" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#E5A93D" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1E293B',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        color: '#F8FAFC',
                      }}
                    />
                    <Area type="monotone" dataKey="count" stroke="#E5A93D" strokeWidth={2} fill="url(#fillUv)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base text-slate-100">RAG 公式库（最新 100 条）</CardTitle>
            <Button onClick={() => void libraryQuery.refetch()} disabled={libraryQuery.isFetching} className="text-xs">
              {libraryQuery.isFetching ? '刷新中...' : '刷新'}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-100">
                <thead>
                  <tr className="border-b border-white/10 bg-black/20">
                    <th className="px-4 py-3 font-medium text-slate-400">时间</th>
                    <th className="px-4 py-3 font-medium text-slate-400">分类</th>
                    <th className="px-4 py-3 font-medium text-slate-400">标题</th>
                    <th className="px-4 py-3 font-medium text-slate-400">开场钩子</th>
                    <th className="px-4 py-3 font-medium text-slate-400">平台</th>
                    <th className="px-4 py-3 font-medium text-slate-400">置信度</th>
                  </tr>
                </thead>
                <tbody>
                  {libraryItems.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-slate-400" colSpan={6}>
                        暂无记录，请先执行上方“开始拆解并入库”。
                      </td>
                    </tr>
                  ) : (
                    libraryItems.map((item) => (
                      <tr key={item.id} className="border-b border-white/5">
                        <td className="px-4 py-3 text-xs text-slate-400">{new Date(item.extractedAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs text-amber-300">{item.category}</td>
                        <td className="px-4 py-3 text-slate-200">{item.title}</td>
                        <td className="max-w-md truncate px-4 py-3 text-slate-300">{item.hook}</td>
                        <td className="px-4 py-3 text-slate-300">{item.source.platform === 'other' ? '其他' : item.source.platform}</td>
                        <td className="px-4 py-3 text-slate-300">{Math.round(item.confidence * 100)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
