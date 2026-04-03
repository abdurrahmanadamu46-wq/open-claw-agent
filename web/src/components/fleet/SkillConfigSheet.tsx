'use client';

/**
 * 动态技能配置抽屉 (Skill Config Sheet)
 * 插件化动态表单：根据技能类型渲染参数，支持全局继承与节点级重写
 */

import { useState, useCallback, useEffect } from 'react';
import type { RemoteNode } from '@/types';
import type { EdgeSkillPackage } from './EdgeSkillSidebar';
import { Settings, Copy, Save, X } from 'lucide-react';

const BORDER = 'rgba(71,85,105,0.5)';
const MUTED = '#94A3B8';
const GOLD = '#E5A93D';
/** 截流探针类技能的配置结构（可按技能 id 扩展不同 schema） */
export interface InterceptProbeConfig {
  /** 监控目标 URL，一行一个 */
  targetUrls: string;
  /** 触发拦截的关键词 */
  triggerKeywords: string[];
  /** 巡逻频率防封抖动（分钟）5-60 */
  patrolIntervalMinutes: number;
  /** 抓到线索后是否立刻推送至全局 Webhook */
  pushToWebhook: boolean;
}

export type SkillConfigPayload = InterceptProbeConfig;

const DEFAULT_INTERCEPT_CONFIG: InterceptProbeConfig = {
  targetUrls: '',
  triggerKeywords: ['求链接', '怎么买', '价格'],
  patrolIntervalMinutes: 25,
  pushToWebhook: true,
};

export interface SkillConfigSheetProps {
  open: boolean;
  onClose: () => void;
  node: RemoteNode | null;
  skill: EdgeSkillPackage | null;
  /** 当前节点已保存的配置（可能为空，则用默认或全局） */
  initialConfig?: SkillConfigPayload | null;
  /** 全局模板（点击「从全局模板导入」时写入表单） */
  globalTemplate?: SkillConfigPayload | null;
  /** 保存并热更新至边缘节点 */
  onSave: (config: SkillConfigPayload) => void;
}

function TagList({
  tags,
  onAdd,
  onRemove,
  placeholder,
}: {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (index: number) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState('');
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = input.trim().replace(/,/g, '');
      if (v) {
        onAdd(v);
        setInput('');
      }
    }
  };
  return (
    <div
      className="flex flex-wrap gap-1.5 rounded-lg border p-2 transition focus-within:ring-2 focus-within:ring-amber-500/50"
      style={{ backgroundColor: 'rgba(15,23,42,0.8)', borderColor: BORDER }}
    >
      {tags.map((t, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
          style={{ backgroundColor: 'rgba(59,130,246,0.25)', color: '#93c5fd' }}
        >
          {t}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="rounded p-0.5 hover:bg-red-500/30"
            aria-label="移除"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-slate-500 focus:ring-0"
        style={{ color: '#F8FAFC' }}
      />
    </div>
  );
}

export function SkillConfigSheet({
  open,
  onClose,
  node,
  skill,
  initialConfig,
  globalTemplate,
  onSave,
}: SkillConfigSheetProps) {
  const [config, setConfig] = useState<InterceptProbeConfig>(() => ({
    ...DEFAULT_INTERCEPT_CONFIG,
    ...initialConfig,
  }));
  useEffect(() => {
    if (open && (node?.nodeId || skill?.id)) {
      setConfig({ ...DEFAULT_INTERCEPT_CONFIG, ...initialConfig });
    }
  }, [open, node?.nodeId, skill?.id, initialConfig]);
  const handleImportGlobal = useCallback(() => {
    if (globalTemplate) setConfig({ ...DEFAULT_INTERCEPT_CONFIG, ...globalTemplate });
  }, [globalTemplate]);
  const [saving, setSaving] = useState(false);

  const addKeyword = useCallback((tag: string) => {
    if (!tag || config.triggerKeywords.includes(tag)) return;
    setConfig((c) => ({ ...c, triggerKeywords: [...c.triggerKeywords, tag] }));
  }, [config.triggerKeywords]);
  const removeKeyword = useCallback((index: number) => {
    setConfig((c) => ({
      ...c,
      triggerKeywords: c.triggerKeywords.filter((_, i) => i !== index),
    }));
  }, []);

  const handleSave = useCallback(() => {
    setSaving(true);
    onSave(config);
    setTimeout(() => {
      setSaving(false);
      onClose();
    }, 600);
  }, [config, onSave, onClose]);

  const patrolWarning = config.patrolIntervalMinutes <= 10;
  const sliderColor = patrolWarning ? '#ef4444' : config.patrolIntervalMinutes <= 20 ? '#eab308' : '#22c55e';

  if (!open || !node || !skill) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-black/50 transition-opacity duration-300"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
        aria-hidden
        onClick={onClose}
      />
      <div
        className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-lg flex-col border-l shadow-2xl transition-transform duration-300 ease-out"
        style={{
          backgroundColor: '#020617',
          borderColor: BORDER,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: BORDER }}>
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold" style={{ color: '#F8FAFC' }}>
              <Settings className="h-5 w-5" style={{ color: GOLD }} />
              配置技能：[{skill.platform}] {skill.name} {skill.version}
            </h2>
            <p className="mt-1 text-xs" style={{ color: MUTED }}>
              当前作用节点：{node.clientName}（{node.nodeId}）
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 transition hover:bg-white/10"
            style={{ color: MUTED }}
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium" style={{ color: GOLD }}>
                监控目标
              </label>
              <textarea
                value={config.targetUrls}
                onChange={(e) => setConfig((c) => ({ ...c, targetUrls: e.target.value }))}
                placeholder="输入需要 24 小时死盯的竞品笔记 URL，一行一个（支持批量粘贴）"
                rows={4}
                className="w-full resize-y rounded-lg border px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-500 focus:ring-2 focus:ring-amber-500/50"
                style={{
                  backgroundColor: 'rgba(15,23,42,0.8)',
                  borderColor: BORDER,
                  color: '#F8FAFC',
                }}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium" style={{ color: GOLD }}>
                触发拦截的关键词
              </label>
              <TagList
                tags={config.triggerKeywords}
                onAdd={addKeyword}
                onRemove={removeKeyword}
                placeholder="输入后回车或逗号添加，如：求链接, 怎么买, 价格"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium" style={{ color: GOLD }}>
                巡逻频率防封抖动（分钟）
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={5}
                  max={60}
                  value={config.patrolIntervalMinutes}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, patrolIntervalMinutes: Number(e.target.value) }))
                  }
                  className="h-2 flex-1 appearance-none rounded-full"
                  style={{
                    backgroundColor: 'rgba(71,85,105,0.5)',
                    accentColor: sliderColor,
                  }}
                />
                <span
                  className="w-12 text-right font-mono text-sm font-medium"
                  style={{ color: patrolWarning ? '#f87171' : '#F8FAFC' }}
                >
                  {config.patrolIntervalMinutes} min
                </span>
              </div>
              {patrolWarning && (
                <p className="mt-1.5 text-xs font-medium" style={{ color: '#f87171' }}>
                  🔴 极易触发滑块验证，建议 ≥ 15 分钟
                </p>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border py-3 px-4" style={{ borderColor: BORDER, backgroundColor: 'rgba(15,23,42,0.5)' }}>
              <span className="text-sm" style={{ color: '#F8FAFC' }}>
                抓到线索后立刻推送至全局 Webhook
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={config.pushToWebhook}
                onClick={() => setConfig((c) => ({ ...c, pushToWebhook: !c.pushToWebhook }))}
                className="relative h-6 w-11 shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:ring-offset-2 focus:ring-offset-slate-950"
                style={{
                  backgroundColor: config.pushToWebhook ? GOLD : 'rgba(71,85,105,0.6)',
                }}
              >
                <span
                  className="absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow transition-transform"
                  style={{ transform: config.pushToWebhook ? 'translateX(20px)' : 'translateX(0)' }}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4" style={{ borderColor: BORDER }}>
          <button
            type="button"
            onClick={handleImportGlobal}
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition hover:bg-white/10"
            style={{ borderColor: BORDER, color: MUTED }}
          >
            <Copy className="h-4 w-4" />
            从全局模板导入参数
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-lg transition disabled:opacity-60"
            style={{
              background: `linear-gradient(135deg, ${GOLD} 0%, #F59E0B 100%)`,
              boxShadow: '0 0 20px rgba(229,169,61,0.35)',
            }}
          >
            <Save className="h-4 w-4" />
            {saving ? '同步中…' : '💾 保存并热更新至边缘节点 (OTA Sync)'}
          </button>
        </div>
      </div>
    </>
  );
}
