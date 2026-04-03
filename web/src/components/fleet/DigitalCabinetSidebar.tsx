'use client';

import { AgentIcon } from '@/components/agents/AgentIcon';
import { CABINET_ROLES, type CabinetRoleId } from '@/types/cabinet';

export interface DigitalCabinetSidebarProps {
  /** 每个角色当前附身的龙虾数量 (nodeId -> roleId 在父组件统计) */
  roleInstanceCounts: Record<CabinetRoleId, number>;
  /** 拖拽开始：设置 dataTransfer，供龙虾卡片 onDrop 使用 */
  onDragStart?: (roleId: CabinetRoleId) => void;
}

const CARD_STYLE = {
  bg: '#1E293B',
  border: 'rgba(255,255,255,0.1)',
  accent: 'rgba(229,169,61,0.35)',
};

export function DigitalCabinetSidebar({
  roleInstanceCounts,
  onDragStart,
}: DigitalCabinetSidebarProps) {
  return (
    <aside
      className="w-56 shrink-0 rounded-xl border p-3"
      style={{
        backgroundColor: '#0F172A',
        borderColor: CARD_STYLE.border,
      }}
    >
      <h3 className="mb-3 px-1 text-sm font-semibold" style={{ color: '#F8FAFC' }}>
        龙虾元老院
      </h3>
      <p className="mb-3 px-1 text-xs" style={{ color: '#94A3B8' }}>
        拖拽角色到龙虾卡片即可注魂
      </p>
      <div className="space-y-2">
        {CABINET_ROLES.map((role) => {
          const count = roleInstanceCounts[role.id] ?? 0;
          const draggable = !!onDragStart;
          return (
            <div
              key={role.id}
              draggable={draggable}
              onDragStart={(e) => {
                if (!onDragStart) return;
                e.dataTransfer.setData('application/x-cabinet-role-id', role.id);
                e.dataTransfer.effectAllowed = 'copy';
                onDragStart(role.id);
              }}
              className="flex cursor-grab flex-col gap-0.5 rounded-lg border p-2 transition-transform active:cursor-grabbing hover:scale-[1.02] active:scale-[0.98]"
              style={{
                backgroundColor: CARD_STYLE.bg,
                borderColor: count > 0 ? CARD_STYLE.accent : CARD_STYLE.border,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex shrink-0 items-center justify-center text-amber-400/90" title={role.name}>
                  <AgentIcon name={role.icon} size={20} />
                </span>
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: count > 0 ? CARD_STYLE.accent : 'rgba(255,255,255,0.08)',
                    color: '#F8FAFC',
                  }}
                >
                  {count} 只
                </span>
              </div>
              <div className="truncate text-xs font-medium" style={{ color: '#F8FAFC' }}>
                {role.name}
              </div>
              <div className="truncate text-[10px]" style={{ color: '#64748b' }}>
                {role.description}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
