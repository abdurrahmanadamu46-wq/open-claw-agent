'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { globalSearch } from '@/services/endpoints/ai-subservice';
import type { SearchResults } from '@/types/search';
import { HighlightText } from '@/components/search/HighlightText';

const QUICK_LINKS = [
  { label: '龙虾池', href: '/dashboard/lobster-pool', icon: '🦞' },
  { label: '工作流', href: '/operations/workflows', icon: '🧭' },
  { label: '渠道账号', href: '/operations/channels', icon: '📡' },
  { label: '边缘节点', href: '/fleet', icon: '🚀' },
  { label: '审计日志', href: '/settings/audit', icon: '🕵️' },
  { label: '功能开关', href: '/operations/feature-flags', icon: '⚙️' },
];

type FlatItem = { group: string; title: string; subtitle?: string; href: string };

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const openHandler = () => setOpen(true);
    document.addEventListener('keydown', down);
    document.addEventListener('global-search-open', openHandler as EventListener);
    return () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('global-search-open', openHandler as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await globalSearch({ q: query, limit: 5 });
        setResults(data);
        setSelectedIndex(0);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const flatResults = useMemo<FlatItem[]>(() => {
    if (!results) return [];
    return [
      ...(results.lobsters || []).map((item) => ({
        group: '龙虾',
        title: item.display_name,
        subtitle: item.description,
        href: item.href,
      })),
      ...(results.workflows || []).map((item) => ({
        group: '工作流',
        title: item.name,
        subtitle: item.description,
        href: item.href,
      })),
      ...(results.channels || []).map((item) => ({
        group: '渠道账号',
        title: item.account_name,
        subtitle: `${item.platform} · ${item.status}`,
        href: item.href,
      })),
      ...((results.audits || []) as Array<{ title: string; description?: string; href: string }>).map((item) => ({
        group: '审计',
        title: item.title,
        subtitle: item.description,
        href: item.href,
      })),
      ...((results.tenants || []) as Array<{ name: string; plan?: string; href: string }>).map((item) => ({
        group: '客户',
        title: item.name,
        subtitle: item.plan,
        href: item.href,
      })),
    ];
  }, [results]);

  useEffect(() => {
    if (!open) return;
    const down = (e: KeyboardEvent) => {
      if (!flatResults.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % flatResults.length);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + flatResults.length) % flatResults.length);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const current = flatResults[selectedIndex];
        if (current) {
          router.push(current.href);
          setOpen(false);
        }
      }
    };
    document.addEventListener('keydown', down);
    return () => {
      document.removeEventListener('keydown', down);
    };
  }, [flatResults, open, router, selectedIndex]);

  const renderResultGroup = (label: string, items: FlatItem[]) => {
    if (!items.length) return null;
    return (
      <div className="mb-4">
        <div className="mb-2 px-3 text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
        <div className="space-y-1">
          {items.map((item) => {
            const absoluteIndex = flatResults.findIndex(
              (row) => row.group === item.group && row.title === item.title && row.href === item.href,
            );
            const active = absoluteIndex === selectedIndex;
            return (
              <button
                key={`${item.group}-${item.title}-${item.href}`}
                type="button"
                onClick={() => {
                  router.push(item.href);
                  setOpen(false);
                }}
                className={`w-full rounded-2xl px-3 py-3 text-left transition ${
                  active
                    ? 'bg-cyan-400/10 text-cyan-100'
                    : 'bg-white/[0.03] text-slate-200 hover:bg-white/[0.06]'
                }`}
              >
                <div className="text-sm font-medium">
                  <HighlightText text={item.title} query={query} />
                </div>
                {item.subtitle ? (
                  <div className="mt-1 text-xs text-slate-400">
                    <HighlightText text={item.subtitle} query={query} />
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl overflow-hidden border-white/10 bg-[#07111f] p-0">
        <div className="border-b border-white/10 px-4 py-4">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索龙虾 / 工作流 / 渠道账号 / 审计"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-3 py-3">
          {!query && (
            <div className="py-6 text-center">
              <p className="mb-4 text-sm text-slate-400">快捷通道 · 访问常用模块</p>
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_LINKS.map((link) => (
                  <button
                    key={link.href}
                    type="button"
                    onClick={() => {
                      router.push(link.href);
                      setOpen(false);
                    }}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200"
                  >
                    <span className="mr-1">{link.icon}</span>
                    {link.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {query.length > 0 && query.length < 2 && (
            <div className="py-6 text-center text-sm text-slate-400">至少输入 2 个字符以启动搜索</div>
          )}
          {loading && <div className="py-6 text-center text-sm text-slate-400">正在搜索...</div>}
          {!loading && query.length >= 2 && results && flatResults.length === 0 && (
            <div className="py-6 text-center text-sm text-slate-400">未找到与“{query}”相关的内容</div>
          )}
          {!loading && results && flatResults.length > 0 && (
            <>
              {renderResultGroup('龙虾', flatResults.filter((item) => item.group === '龙虾'))}
              {renderResultGroup('工作流', flatResults.filter((item) => item.group === '工作流'))}
              {renderResultGroup('渠道账号', flatResults.filter((item) => item.group === '渠道账号'))}
              {renderResultGroup('审计', flatResults.filter((item) => item.group === '审计'))}
              {renderResultGroup('客户', flatResults.filter((item) => item.group === '客户'))}
            </>
          )}
        </div>
        <div className="border-t border-white/10 px-4 py-3 text-xs text-slate-500">
          <span className="mr-4">↑↓ 选择</span>
          <span className="mr-4">Enter 跳转</span>
          <span>Esc 关闭</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
