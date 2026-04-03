'use client';

/**
 * 龙虾智能池卡片 — 活体终端 + 联动穿梭门 + 算力账本
 * 硅谷级作战指挥大屏：实时日志滚动、战役/边缘节点一键跳转
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Settings, Pause, BookOpen, Target, Radio } from 'lucide-react';
import { AgentIcon } from '@/components/agents/AgentIcon';
import type { CustomLobsterAgent } from '@/data/custom-lobster-agents';

const BORDER = 'rgba(71,85,105,0.4)';
const MUTED = '#94A3B8';
const GOLD = '#E5A93D';

export type AgentCardStatus = 'idle' | 'thinking' | 'executing';

export interface AgentCardProps {
  agent: CustomLobsterAgent;
  engineOptions: { value: string; label: string }[];
  engineValue: string;
  onEngineChange: (value: string) => void;
  isDormant: boolean;
  onToggleDormant: () => void;
  status: AgentCardStatus;
  ragCount?: number;
  /** 当前所属战役名称（联动 Badge 跳转任务总控） */
  campaignLabel?: string;
  /** 战役筛选参数（如 campaignId），用于 /operations/orchestrator?campaign=xxx */
  campaignFilter?: string;
  /** 正在驱使的边缘节点数（联动 Badge 跳转边缘算力池） */
  commandingCount: number;
  /** 驱使节点时的筛选参数（如 agentId），用于 /fleet?agent=xxx */
  fleetFilter?: string;
  /** 活体终端滚动日志行（最新在上） */
  liveLogLines: string[];
  tokensToday: number;
  costEstimateYuan: number;
  engineLabel: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function AgentCard({
  agent,
  engineOptions,
  engineValue,
  onEngineChange,
  isDormant,
  onToggleDormant,
  status,
  ragCount = 0,
  campaignLabel,
  campaignFilter,
  commandingCount,
  fleetFilter,
  liveLogLines,
  tokensToday,
  costEstimateYuan,
  engineLabel,
}: AgentCardProps) {
  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    if (liveLogLines.length <= 1) return;
    const t = setInterval(() => {
      setScrollOffset((i) => (i + 1) % Math.max(1, liveLogLines.length));
    }, 2600);
    return () => clearInterval(t);
  }, [liveLogLines.length]);

  const displayLogs =
    liveLogLines.length > 0
      ? Array.from({ length: 4 }, (_, i) => liveLogLines[(scrollOffset + i) % liveLogLines.length])
      : ['> [--:--:--] 待命中...'];

  return (
    <div
      className="group relative flex flex-col rounded-xl border transition-all duration-300 hover:shadow-lg"
      style={{
        background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(59,130,246,0.06), transparent 50%), rgba(30, 41, 59, 0.6)',
        borderColor: isDormant ? 'rgba(100, 116, 139, 0.5)' : BORDER,
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(229,169,61,0.15), transparent)',
          border: '1px solid rgba(229,169,61,0.3)',
          margin: -1,
          padding: 1,
        }}
      />

      {/* 右上角呼吸灯状态 */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        {status === 'idle' && (
          <>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: '#475569' }} title="待命休眠" />
            <span className="text-[10px] italic text-slate-500">Standby</span>
          </>
        )}
        {status === 'thinking' && (
          <>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-500 animate-pulse"
              style={{ boxShadow: '0 0 10px rgba(99,102,241,0.8), 0 0 20px rgba(99,102,241,0.4)' }}
              title="思考与生成中"
            />
            <span className="text-[10px] italic text-indigo-400">Thinking...</span>
          </>
        )}
        {status === 'executing' && (
          <>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 animate-pulse"
              style={{ boxShadow: '0 0 8px rgba(16,185,129,0.7), 0 0 16px rgba(16,185,129,0.3)', animationDuration: '1s' }}
              title="统帅执行中"
            />
            <span className="text-[10px] italic text-emerald-400">Dispatching...</span>
          </>
        )}
      </div>

      <div className="relative flex flex-1 flex-col p-4">
        <div className="mb-3 flex items-center gap-3 pr-20">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
            <AgentIcon name={agent.icon} size={22} />
          </span>
          <h3 className="font-semibold" style={{ color: '#F8FAFC' }}>
            {agent.name}
          </h3>
        </div>

        {/* 思考引擎 */}
        <div className="mb-3">
          <label className="mb-1.5 block text-xs font-medium" style={{ color: GOLD }}>
            思考引擎 (LLM Brain)
          </label>
          <select
            value={engineValue}
            onChange={(e) => onEngineChange(e.target.value)}
            disabled={isDormant}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{
              backgroundColor: 'rgba(15, 23, 42, 0.8)',
              borderColor: BORDER,
              color: '#F8FAFC',
            }}
          >
            {engineOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 联动穿梭门：战役 + 驱使边缘节点 */}
        <div className="mb-3 flex flex-wrap gap-2">
          {campaignLabel && (
            <Link
              href={campaignFilter ? `/operations/orchestrator?campaign=${encodeURIComponent(campaignFilter)}` : '/operations/orchestrator'}
              className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:border-amber-500/60 hover:shadow-[0_0_12px_rgba(229,169,61,0.25)]"
              style={{ borderColor: 'rgba(229,169,61,0.4)', color: '#fcd34d' }}
            >
              <Target className="h-3 w-3" />
              战役: {campaignLabel}
            </Link>
          )}
          <Link
            href={fleetFilter ? `/fleet?agent=${encodeURIComponent(fleetFilter)}` : '/fleet'}
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:border-emerald-500/60 hover:shadow-[0_0_12px_rgba(16,185,129,0.2)]"
            style={{
              borderColor: commandingCount > 0 ? 'rgba(16,185,129,0.5)' : BORDER,
              color: commandingCount > 0 ? '#6ee7b7' : MUTED,
            }}
          >
            <Radio className="h-3 w-3" />
            驱使: {commandingCount} 台边缘节点
          </Link>
        </div>

        {/* 语料 Badge */}
        <div className="mb-3">
          {ragCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs" style={{ color: '#fcd34d' }}>
              <BookOpen className="h-3 w-3" />
              已挂载 {ragCount} 份品牌语料
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-slate-500/20 px-2 py-0.5 text-xs" style={{ color: MUTED }}>
              ⚠️ 使用系统默认设定
            </span>
          )}
        </div>

        {/* 活体终端 (Live Activity Terminal) */}
        <div
          className="mb-3 overflow-hidden rounded-md border p-2"
          style={{
            height: '80px',
            backgroundColor: 'rgba(0,0,0,0.8)',
            borderColor: 'rgb(30 41 59)',
          }}
        >
          <div className="flex h-full flex-col justify-end gap-0.5 font-mono text-xs leading-tight" style={{ color: 'rgba(74,222,128,0.85)' }}>
            {displayLogs.map((line, i) => (
              <div key={i} className="truncate" title={line}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 算力消耗账本 */}
      <div className="mx-4 mb-3 group/ledger">
        <div
          className="relative rounded-md bg-slate-900/50 p-2"
          title={`数据源自当前绑定的 ${engineLabel} 引擎消耗`}
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-mono font-medium text-slate-300">
              ⚡ 今日算力: {formatTokens(tokensToday)} Tokens
            </span>
            <span className="font-medium text-amber-400/90">
              💰 约 ¥{costEstimateYuan.toFixed(2)}
            </span>
          </div>
          <div
            className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-300 shadow-xl group-hover/ledger:block"
            role="tooltip"
          >
            数据源自当前绑定的 {engineLabel} 引擎消耗
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="flex gap-2 border-t px-4 py-3" style={{ borderColor: BORDER }}>
        <Link
          href="/arsenal/prompts"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition hover:bg-white/10"
          style={{ borderColor: BORDER, color: GOLD }}
        >
          <Settings className="h-3.5 w-3.5" />
          调教大脑
        </Link>
        <button
          type="button"
          onClick={onToggleDormant}
          className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${isDormant ? 'opacity-60' : 'hover:bg-white/10'}`}
          style={{ borderColor: BORDER, color: MUTED }}
        >
          <Pause className="h-3.5 w-3.5" />
          {isDormant ? '已休眠' : '全局休眠'}
        </button>
      </div>
    </div>
  );
}
