'use client';

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RemoteNode, RemoteNodeStatus } from '@/types';
import { getFleetNodes } from '@/services/node.service';
import { useTenant } from '@/contexts/TenantContext';
import {
  Target,
  Upload,
  Sparkles,
  Shield,
  Rocket,
  ChevronDown,
  ChevronRight,
  MonitorSmartphone,
  Link2,
  AtSign,
  Hash,
  Calendar,
  Clock,
} from 'lucide-react';

const BORDER = 'rgba(71,85,105,0.5)';
const CARD_BG = '#1E293B';
const MUTED = '#94A3B8';
const GOLD = '#E5A93D';

function getPlatformLabel(platform: string): string {
  const map: Record<string, string> = {
    douyin: '抖音',
    xiaohongshu: '小红书',
    wechat: '微信',
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
    chrome: 'Chrome',
    kuaishou: '快手',
  };
  return (map[platform] ?? platform) || '多平台';
}

function canSelectNode(status: RemoteNodeStatus): boolean {
  return status === 'ONLINE';
}

export default function TacticalLaunchConsolePage() {
  const { currentTenantId, currentTenant } = useTenant();
  const { data: allNodes = [] } = useQuery({
    queryKey: ['fleet', 'nodes'],
    queryFn: getFleetNodes,
  });

  const displayNodes = useMemo(
    () => allNodes.filter((n) => n.tenantId === currentTenantId),
    [allNodes, currentTenantId],
  );
  const availableCount = displayNodes.filter((n) => canSelectNode(n.status)).length;

  const [files, setFiles] = useState<File[]>([]);
  const [copy, setCopy] = useState('');
  const [aiPolishLoading, setAiPolishLoading] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [launchMode, setLaunchMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledDate, setScheduledDate] = useState('');
  useEffect(() => {
    const d = new Date();
    setScheduledDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }, []);
  const [scheduledTime, setScheduledTime] = useState('14:00');
  const [jitterMinutes, setJitterMinutes] = useState(10);
  const [accordionOpen, setAccordionOpen] = useState<Record<string, boolean>>({
    hashtags: false,
    at: false,
    product: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleNode = useCallback((nodeId: string) => {
    const node = displayNodes.find((n) => n.nodeId === nodeId);
    if (!node || !canSelectNode(node.status)) return;
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, [displayNodes]);

  const selectAllAvailable = useCallback(() => {
    const available = displayNodes.filter((n) => canSelectNode(n.status)).map((n) => n.nodeId);
    setSelectedNodeIds((prev) => {
      if (prev.size === available.length) return new Set<string>();
      return new Set(available);
    });
  }, [displayNodes]);

  const handleAiPolish = useCallback(async () => {
    setAiPolishLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setCopy((c) =>
      c.trim()
        ? `${c}\n\n#种草 #好物分享 #黄皮亲妈 #显白口红`
        : '姐妹们！这款口红真的绝了，显白又不拔干。#种草 #好物分享',
    );
    setAiPolishLoading(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const list = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('video/') || f.type.startsWith('image/'),
    );
    setFiles((prev) => [...prev, ...list].slice(0, 5));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []).filter(
      (f) => f.type.startsWith('video/') || f.type.startsWith('image/'),
    );
    setFiles((prev) => [...prev, ...list].slice(0, 5));
    e.target.value = '';
  }, []);

  const handleLaunch = useCallback(async () => {
    if (selectedNodeIds.size === 0) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: '手动配置战焦',
          sell_points: copy || '手动发布控制台',
          sop_template_id: '10s-viral',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || '下发失败');
      const campaignId = (data as { campaignId?: string }).campaignId;
      window.dispatchEvent(
        new CustomEvent('clawcommerce-toast', {
          detail: {
            type: 'success',
            message: campaignId
              ? `任务 ${campaignId} 已创建并生成分镜，已下发至 ${selectedNodeIds.size} 个节点`
              : `SOP 指令包已生成并下发至 ${selectedNodeIds.size} 个节点`,
          },
        }),
      );
    } catch (e) {
      window.dispatchEvent(
        new CustomEvent('clawcommerce-toast', {
          detail: { type: 'error', message: e instanceof Error ? e.message : '下发失败' },
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedNodeIds.size, copy]);

  const toggleAccordion = (key: string) => {
    setAccordionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectedCount = selectedNodeIds.size;

  return (
    <div className="min-h-0 bg-[#0F172A] text-slate-100">
      <div className="border-b px-4 py-4 md:px-6" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2">
          <Target className="h-6 w-6" style={{ color: GOLD }} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">战术狙击发射台</h1>
            <p className="mt-0.5 text-sm" style={{ color: MUTED }}>
              精确制导 · 手动配置发布 · 当前空间：{currentTenant?.name ?? '—'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[35%_35%_30%]">
        <div
          className="border-b p-4 lg:border-b-0 lg:border-r"
          style={{ borderColor: BORDER, backgroundColor: CARD_BG }}
        >
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
            <Upload className="h-4 w-4" />
            弹药装填 (Payload Configuration)
          </h2>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            aria-hidden
          />
          <div
            role="button"
            tabIndex={0}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
            className="mb-4 flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-6 transition hover:border-amber-500/50 hover:bg-slate-800/30 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            style={{ borderColor: BORDER }}
          >
            <Upload className="mb-2 h-10 w-10" style={{ color: MUTED }} />
            <p className="text-center text-sm" style={{ color: MUTED }}>
              拖拽 4K 视频 / 图文 到此处上传
            </p>
            <p className="mt-1 text-xs" style={{ color: MUTED }}>
              或点击选择文件
            </p>
            {files.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {files.map((f, i) => (
                  <span
                    key={i}
                    className="rounded-lg border px-2 py-1 text-xs"
                    style={{ borderColor: BORDER, color: '#F8FAFC' }}
                  >
                    {f.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="relative mb-4">
            <label className="mb-1 block text-xs font-medium" style={{ color: MUTED }}>
              发布文案（人机共创）
            </label>
            <textarea
              value={copy}
              onChange={(e) => setCopy(e.target.value)}
              placeholder="输入正文，可点击右下角由黄金编剧智能润色（Emoji + Hashtag）"
              rows={5}
              className="w-full resize-none rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              style={{ backgroundColor: '#0f172a', borderColor: BORDER, color: '#F8FAFC' }}
            />
            <button
              type="button"
              onClick={handleAiPolish}
              disabled={aiPolishLoading}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-amber-500/20 disabled:opacity-50"
              style={{ borderColor: 'rgba(229,169,61,0.5)', color: GOLD }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {aiPolishLoading ? '润色中…' : '调用黄金编剧 智能润色'}
            </button>
          </div>

          <div className="space-y-1 rounded-lg border" style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}>
            {[
              { key: 'hashtags', label: '话题标签', icon: Hash },
              { key: 'at', label: '@ 好友', icon: AtSign },
              { key: 'product', label: '挂载商品链接', icon: Link2 },
            ].map(({ key, label, icon: Icon }) => (
              <div key={key} className="border-b last:border-b-0" style={{ borderColor: BORDER }}>
                <button
                  type="button"
                  onClick={() => toggleAccordion(key)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition hover:bg-white/5"
                  style={{ color: '#F8FAFC' }}
                >
                  <span className="flex items-center gap-2">
                    {accordionOpen[key] ? (
                      <ChevronDown className="h-4 w-4" style={{ color: MUTED }} />
                    ) : (
                      <ChevronRight className="h-4 w-4" style={{ color: MUTED }} />
                    )}
                    <Icon className="h-4 w-4" style={{ color: GOLD }} />
                    {label}
                  </span>
                </button>
                {accordionOpen[key] && (
                  <div className="border-t px-3 py-2 pb-3" style={{ borderColor: BORDER }}>
                    <input
                      type="text"
                      placeholder={key === 'product' ? 'https://...' : '输入后回车添加'}
                      className="w-full rounded border px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                      style={{ backgroundColor: '#1E293B', borderColor: BORDER, color: '#F8FAFC' }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div
          className="border-b p-4 lg:border-b-0 lg:border-r"
          style={{ borderColor: BORDER, backgroundColor: CARD_BG }}
        >
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
            <MonitorSmartphone className="h-4 w-4" />
            点兵点将 (Matrix Dispatch)
          </h2>
          <p className="mb-3 text-xs" style={{ color: MUTED }}>
            选择目标执行节点（当前空间可用：{availableCount}）
          </p>
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={selectAllAvailable}
              className="text-xs font-medium hover:underline"
              style={{ color: GOLD }}
            >
              {selectedNodeIds.size === availableCount && availableCount > 0 ? '取消全选' : '全选可用'}
            </button>
          </div>
          <ul className="max-h-[420px] space-y-0 overflow-y-auto rounded-lg border" style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}>
            {displayNodes.map((node) => {
              const checked = selectedNodeIds.has(node.nodeId);
              const selectable = canSelectNode(node.status);
              const statusLabel =
                node.status === 'ONLINE'
                  ? '在线'
                  : node.status === 'BUSY'
                    ? '忙碌中'
                    : node.status === 'INTERVENTION_REQUIRED'
                      ? '待人工介入'
                      : '离线';
              const platform = node.systemMetrics.platforms?.[0] ?? 'other';
              return (
                <li key={node.nodeId} className="border-b last:border-b-0" style={{ borderColor: BORDER }}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 transition ${
                      !selectable ? 'cursor-not-allowed opacity-60' : checked ? 'bg-amber-500/15' : 'hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleNode(node.nodeId)}
                      disabled={!selectable}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-500 accent-amber-500 disabled:cursor-not-allowed"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium" style={{ color: '#F8FAFC' }}>
                        [{getPlatformLabel(platform)}] {node.clientName}
                      </span>
                      <div className="mt-0.5 flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                        <span>{statusLabel}</span>
                        <span>·</span>
                        <span>{node.nodeId}</span>
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
          {displayNodes.length === 0 && (
            <p className="py-6 text-center text-sm" style={{ color: MUTED }}>
              当前空间暂无节点，请先接入龙虾节点。
            </p>
          )}
        </div>

        <div className="p-4" style={{ backgroundColor: CARD_BG }}>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
            <Rocket className="h-4 w-4" />
            执行策略 (Launch Strategy)
          </h2>

          <div className="mb-4">
            <p className="mb-2 text-xs font-medium" style={{ color: MUTED }}>
              时间轴设置
            </p>
            <div className="space-y-2" role="radiogroup" aria-label="执行时间">
              {[
                { value: 'immediate' as const, label: '立即发射', icon: '⚡' },
                { value: 'scheduled' as const, label: '精准定时', icon: '⏰' },
              ].map(({ value, label, icon }) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                    launchMode === value ? 'border-amber-500/50 bg-amber-500/10' : 'hover:bg-white/5'
                  }`}
                  style={{ borderColor: launchMode === value ? undefined : BORDER }}
                >
                  <input
                    type="radio"
                    name="launchMode"
                    value={value}
                    checked={launchMode === value}
                    onChange={() => setLaunchMode(value)}
                    className="h-4 w-4 accent-amber-500"
                  />
                  <span className="text-sm font-medium" style={{ color: '#F8FAFC' }}>
                    {icon} {label}
                  </span>
                </label>
              ))}
            </div>
            {launchMode === 'scheduled' && (
              <div className="mt-3 flex gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}>
                  <Calendar className="h-4 w-4" style={{ color: MUTED }} />
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
                    style={{ color: '#F8FAFC' }}
                  />
                </div>
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: BORDER, backgroundColor: '#0f172a' }}>
                  <Clock className="h-4 w-4" style={{ color: MUTED }} />
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="bg-transparent text-sm focus:outline-none"
                    style={{ color: '#F8FAFC' }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border p-4" style={{ borderColor: 'rgba(229,169,61,0.3)', backgroundColor: 'rgba(229,169,61,0.06)' }}>
            <div className="mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4" style={{ color: GOLD }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                防封抖动设置 (Anti-Detect)
              </span>
            </div>
            <p className="mb-3 text-xs" style={{ color: MUTED }}>
              通过随机延迟（分钟）打散矩阵发射节奏，让多号不在同一时间同时发出，更像真实人工发布。
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={30}
                value={jitterMinutes}
                onChange={(e) => setJitterMinutes(Number(e.target.value))}
                className="h-2 flex-1 appearance-none rounded-full accent-amber-500"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
              />
              <span className="w-10 text-right text-sm font-mono font-medium" style={{ color: '#F8FAFC' }}>
                {jitterMinutes} min
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="sticky bottom-0 left-0 right-0 flex flex-wrap items-center justify-between gap-4 border-t px-4 py-4 md:px-6"
        style={{ borderColor: BORDER, backgroundColor: CARD_BG, boxShadow: '0 -4px 24px rgba(0,0,0,0.3)' }}
      >
        <div className="flex items-center gap-4 text-sm">
          <span style={{ color: MUTED }}>
            已选节点：<strong className="font-semibold" style={{ color: '#F8FAFC' }}>{selectedCount}</strong> 个
          </span>
        </div>
        <button
          type="button"
          onClick={handleLaunch}
          disabled={selectedCount === 0 || isSubmitting}
          className="flex w-full min-w-[280px] max-w-md items-center justify-center gap-2 rounded-xl py-4 text-base font-semibold text-slate-900 shadow-lg transition disabled:opacity-50 md:w-auto"
          style={{
            background: `linear-gradient(135deg, ${GOLD} 0%, #F59E0B 100%)`,
            boxShadow: '0 0 24px rgba(229,169,61,0.4)',
          }}
        >
          <Rocket className="h-5 w-5" />
          {isSubmitting ? '正在生成并下发…' : '锁定目标，确认下发 SOP'}
        </button>
      </div>
    </div>
  );
}
