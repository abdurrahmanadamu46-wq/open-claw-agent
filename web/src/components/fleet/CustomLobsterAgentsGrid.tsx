'use client';

import { motion } from 'framer-motion';
import { AgentIcon } from '@/components/agents/AgentIcon';
import { CUSTOM_LOBSTER_AGENTS, type CustomLobsterAgent } from '@/data/custom-lobster-agents';

const CARD_GLOW = '0 0 16px rgba(0,212,255,0.2), 0 0 32px rgba(229,169,61,0.08)';
const BORDER_GLOW = 'rgba(0,212,255,0.35)';

export interface CustomLobsterAgentsGridProps {
  onSelectAgent: (agent: CustomLobsterAgent) => void;
}

export function CustomLobsterAgentsGrid({ onSelectAgent }: CustomLobsterAgentsGridProps) {
  return (
    <section className="rounded-xl border p-4" style={{ backgroundColor: '#0B0F1A', borderColor: 'rgba(255,255,255,0.08)' }}>
      <h2 className="mb-1 text-base font-semibold" style={{ color: '#F8FAFC' }}>
        龙虾元老院
      </h2>
      <p className="mb-4 text-xs" style={{ color: '#64748b' }}>
        数字员工角色 · 点击查看性格与专属技能
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {CUSTOM_LOBSTER_AGENTS.map((agent) => (
          <motion.button
            key={agent.id}
            type="button"
            onClick={() => onSelectAgent(agent)}
            className="flex flex-col items-center rounded-xl border p-4 text-center transition"
            style={{
              backgroundColor: '#111827',
              borderColor: 'rgba(255,255,255,0.1)',
            }}
            whileHover={{
              borderColor: BORDER_GLOW,
              boxShadow: CARD_GLOW,
            }}
            whileTap={{ scale: 0.98 }}
          >
            {/* 头像化：Lucide 图标 + 深色圆形容器 + 微发光边框 */}
            <div
              className="mb-3 flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 text-amber-400/90"
              style={{
                backgroundColor: '#0F172A',
                borderColor: BORDER_GLOW,
                boxShadow: `inset 0 0 20px rgba(0,0,0,0.4), 0 0 14px rgba(0,212,255,0.2)`,
              }}
            >
              <AgentIcon name={agent.icon} size={32} />
            </div>
            <span className="mb-1 truncate w-full text-sm font-medium" style={{ color: '#F8FAFC' }}>
              {agent.name}
            </span>
            {/* 职位牌 / 隐藏代号 */}
            <span
              className="truncate w-full rounded px-2 py-0.5 text-[10px]"
              style={{
                color: '#94A3B8',
                backgroundColor: 'rgba(229,169,61,0.1)',
                border: '1px solid rgba(229,169,61,0.25)',
              }}
            >
              {agent.codename}
            </span>
            <span className="mt-1 line-clamp-2 text-[10px]" style={{ color: '#64748b' }}>
              {agent.description}
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
