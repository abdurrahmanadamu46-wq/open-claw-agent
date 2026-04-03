'use client';

/**
 * 龙虾元老院 — 按名称渲染对应 Lucide 图标
 * 与 data/custom-lobster-agents.ts 的 AgentIconName 对齐
 */
import {
  ScanSearch,
  Brain,
  PenLine,
  Image,
  Send,
  MessageCircle,
  Filter,
  Calculator,
  Phone,
  Bot,
  type LucideIcon,
} from 'lucide-react';
import type { AgentIconName } from '@/data/custom-lobster-agents';

const ICON_MAP: Record<AgentIconName, LucideIcon> = {
  ScanSearch,
  Brain,
  PenLine,
  Image,
  Send,
  MessageCircle,
  Filter,
  Calculator,
  Phone,
};

export interface AgentIconProps {
  name: AgentIconName;
  className?: string;
  size?: number;
}

export function AgentIcon({ name, className, size = 24 }: AgentIconProps) {
  const Icon = ICON_MAP[name] ?? Bot;
  return <Icon className={className} size={size} />;
}
