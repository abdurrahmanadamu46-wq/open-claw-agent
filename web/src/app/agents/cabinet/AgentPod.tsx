'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Settings, Pause, Play, Cpu, BookOpen, Puzzle, GitBranch, Clock3 } from 'lucide-react';
import { AgentPodIcon } from './AgentPodSvgs';
import type { CustomLobsterAgent, CustomLobsterAgentId } from '@/data/custom-lobster-agents';

export type AgentCardStatus = 'idle' | 'thinking' | 'executing';

export interface AgentPodProps {
  agent: CustomLobsterAgent;
  engineOptions: { value: string; label: string }[];
  engineValue: string;
  onEngineChange: (value: string) => void;
  isDormant: boolean;
  onToggleDormant: () => void;
  status: AgentCardStatus;
  ragCount: number;
  skillsCount: number;
  nodesCount: number;
  runtimeMode: 'local' | 'cloud' | 'hybrid' | 'unknown';
  taskType: string;
  modelName: string;
  providerLabel: string;
  lastUpdatedAt: string;
}

export function getPodNeonColor(agentId: CustomLobsterAgentId): string {
  const map: Record<CustomLobsterAgentId, string> = {
    radar: 'var(--commander-radar)',
    strategist: 'var(--commander-brain)',
    inkwriter: 'var(--commander-brain-alt)',
    visualizer: 'var(--commander-visualizer)',
    dispatcher: 'var(--commander-dispatcher)',
    echoer: 'var(--commander-interaction)',
    catcher: 'var(--commander-interaction-alt)',
    abacus: 'var(--commander-abacus)',
    followup: 'var(--commander-follow-up)',
  };
  return map[agentId] ?? 'var(--commander-brain)';
}

function getStatusText(status: AgentCardStatus): string {
  if (status === 'executing') return '运行中';
  if (status === 'thinking') return '待命';
  return '休眠';
}

function getStatusDotColor(status: AgentCardStatus, neonColor: string): string {
  if (status === 'executing') return '#22c55e';
  if (status === 'thinking') return neonColor;
  return '#64748b';
}

function runtimeText(mode: AgentPodProps['runtimeMode']): string {
  if (mode === 'hybrid') return '混合';
  if (mode === 'local') return '本地';
  if (mode === 'cloud') return '云端';
  return '-';
}

function safeText(value: string | undefined | null): string {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : '-';
}

export function AgentPod({
  agent,
  engineOptions,
  engineValue,
  onEngineChange,
  isDormant,
  onToggleDormant,
  status,
  ragCount,
  skillsCount,
  nodesCount,
  runtimeMode,
  taskType,
  modelName,
  providerLabel,
  lastUpdatedAt,
}: AgentPodProps) {
  const neonColor = getPodNeonColor(agent.id);

  return (
    <div
      className="commander-pod-hover group relative flex flex-col rounded-xl border bg-white/5 backdrop-blur-md transition-all duration-300"
      style={{
        ['--commander-pod-glow-color' as string]: neonColor,
        borderColor: isDormant ? 'rgba(255,255,255,0.15)' : `${neonColor}88`,
        boxShadow: isDormant ? 'none' : `0 0 12px ${neonColor}40, 0 0 20px ${neonColor}20`,
      }}
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2"
          style={{ borderColor: neonColor, color: neonColor, background: `${neonColor}15` }}
        >
          <AgentPodIcon agentId={agent.id} color={neonColor} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-slate-100">{agent.name}</h3>
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: getStatusDotColor(status, neonColor), boxShadow: `0 0 8px ${getStatusDotColor(status, neonColor)}` }}
            />
            <span style={{ color: getStatusDotColor(status, neonColor) }}>{getStatusText(status)}</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-400">{agent.description}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium" style={{ color: neonColor }}>
            模型路由
          </label>
          <div className="relative">
            <select
              value={engineValue}
              onChange={(e) => !isDormant && onEngineChange(e.target.value)}
              disabled={isDormant}
              className="w-full appearance-none rounded-lg border py-2 pl-3 pr-8 text-xs font-medium transition focus:outline-none focus:ring-1"
              style={{
                borderColor: `${neonColor}66`,
                background: 'rgba(0,0,0,0.35)',
                color: '#e2e8f0',
              }}
            >
              {engineOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] opacity-70" style={{ color: neonColor }}>
              ▼
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <MetricChip icon={<Cpu className="h-3 w-3" />} label="运行模式" value={runtimeText(runtimeMode)} neonColor={neonColor} />
          <MetricChip icon={<BookOpen className="h-3 w-3" />} label="RAG" value={`${ragCount}`} neonColor={neonColor} />
          <MetricChip icon={<Puzzle className="h-3 w-3" />} label="技能数" value={`${skillsCount}`} neonColor={neonColor} />
          <MetricChip icon={<GitBranch className="h-3 w-3" />} label="节点数" value={`${nodesCount}`} neonColor={neonColor} />
        </div>

        <div className="rounded-lg border border-white/10 bg-black/30 p-2.5 text-xs">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-slate-400">服务商</span>
            <span className="truncate text-slate-200">{safeText(providerLabel)}</span>
          </div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-slate-400">模型</span>
            <span className="truncate text-slate-200">{safeText(modelName)}</span>
          </div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-slate-400">任务</span>
            <span className="truncate text-slate-200">{safeText(taskType)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Clock3 className="h-3 w-3" />
              最近同步
            </span>
            <span className="truncate text-slate-300">{safeText(lastUpdatedAt)}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-t border-white/10 px-4 py-3">
        <Link
          href="/operations/skills-pool"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition hover:bg-white/10"
          style={{ borderColor: neonColor, color: neonColor }}
        >
          <Settings className="h-3.5 w-3.5" />
          打开技能池
        </Link>
        <button
          type="button"
          onClick={onToggleDormant}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10"
        >
          {isDormant ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {isDormant ? '恢复' : '休眠'}
        </button>
      </div>
    </div>
  );
}

function MetricChip({
  icon,
  label,
  value,
  neonColor,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  neonColor: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
      <div className="mb-0.5 inline-flex items-center gap-1 text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="font-medium" style={{ color: neonColor }}>
        {value}
      </div>
    </div>
  );
}
