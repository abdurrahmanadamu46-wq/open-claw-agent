'use client';

export const EDGE_SKILL_DROP_TYPE = 'application/x-edge-skill-id';

export interface EdgeSkillPackage {
  id: string;
  name: string;
  platform: string;
  version: string;
  authorized: boolean;
  icon?: string;
}

const BORDER = 'rgba(71,85,105,0.5)';
const CARD_BG = '#1E293B';
const MUTED = '#94A3B8';

export interface EdgeSkillSidebarProps {
  skills?: EdgeSkillPackage[];
  onDragStart?: (skill: EdgeSkillPackage) => void;
}

export function EdgeSkillSidebar({ skills = [], onDragStart }: EdgeSkillSidebarProps) {
  return (
    <aside
      className="w-60 shrink-0 rounded-xl border p-3"
      style={{
        backgroundColor: '#0F172A',
        borderColor: BORDER,
      }}
    >
      <h3 className="mb-1 px-1 text-sm font-semibold" style={{ color: '#F8FAFC' }}>
        边缘技能仓库
      </h3>
      <p className="mb-3 px-1 text-xs" style={{ color: MUTED }}>
        拖拽已授权技能到节点，触发真实 OTA 下发。
      </p>

      {skills.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-600 bg-slate-900/50 px-2 py-4 text-center text-xs text-slate-400">
          暂无可用技能包，请先在“龙虾技能沉淀池”完成接入。
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => {
            const draggable = !!onDragStart && skill.authorized;
            const isLocked = !skill.authorized;
            return (
              <div
                key={skill.id}
                draggable={draggable}
                onDragStart={(e) => {
                  if (!onDragStart || !skill.authorized) return;
                  e.dataTransfer.setData(EDGE_SKILL_DROP_TYPE, skill.id);
                  e.dataTransfer.effectAllowed = 'copy';
                  onDragStart(skill);
                }}
                className={`flex flex-col gap-1.5 rounded-lg border p-2.5 transition ${
                  isLocked
                    ? 'cursor-not-allowed opacity-70'
                    : 'cursor-grab active:cursor-grabbing hover:scale-[1.02] active:scale-[0.98]'
                }`}
                style={{
                  backgroundColor: isLocked ? 'rgba(30,41,59,0.5)' : CARD_BG,
                  borderColor: isLocked ? 'rgba(100,116,139,0.4)' : BORDER,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base" title={skill.platform}>
                    {skill.icon || '🧩'}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium"
                    style={{
                      backgroundColor: isLocked ? 'rgba(100,116,139,0.3)' : 'rgba(59,130,246,0.25)',
                      color: isLocked ? MUTED : '#93c5fd',
                    }}
                  >
                    {skill.version}
                  </span>
                </div>
                <div className="text-xs font-medium" style={{ color: isLocked ? MUTED : '#F8FAFC' }}>
                  [{skill.platform}] {skill.name}
                </div>
                <div className="flex items-center gap-1 text-[10px]" style={{ color: MUTED }}>
                  {skill.authorized ? (
                    <span className="text-emerald-400/90">已授权</span>
                  ) : (
                    <span className="text-amber-400/90">未授权</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

