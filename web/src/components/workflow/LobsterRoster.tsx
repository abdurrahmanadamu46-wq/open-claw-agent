'use client';

import { LOBSTER_META, type IndustryWorkflowFrontendPreview } from '@/data/workflow-board-mock';

interface LobsterRosterProps {
  agents: IndustryWorkflowFrontendPreview['baselineAgentSummary'];
}

const ALL_ROLES = ['radar', 'strategist', 'inkwriter', 'visualizer', 'dispatcher', 'echoer', 'catcher', 'abacus', 'followup', 'feedback'];

export function LobsterRoster({ agents }: LobsterRosterProps) {
  const present = new Map(agents.map((agent) => [agent.roleId, agent]));

  return (
    <section className="rounded-2xl border border-gray-700 bg-gray-800 p-4">
      <div className="mb-4">
        <div className="text-sm font-semibold text-gray-100">龙虾阵容</div>
        <div className="mt-1 text-xs text-gray-400">本次工作流谁参与、默认桥接到哪里、有哪些启动技能，一眼看清。</div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {ALL_ROLES.map((roleId) => {
          const item = present.get(roleId);
          const meta = LOBSTER_META[roleId] || { zhName: roleId, emoji: '🦞' };
          const inactive = !item;

          return (
            <div
              key={roleId}
              className={`min-w-[220px] rounded-2xl border p-4 ${inactive ? 'border-gray-700 bg-gray-900/60 opacity-55' : 'border-white/10 bg-white/[0.03]'}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{meta.emoji}</span>
                <div>
                  <div className="text-sm font-semibold text-gray-100">{meta.zhName}</div>
                  <div className="text-xs text-gray-500">{roleId}</div>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-xs">
                <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                  <div className="uppercase tracking-[0.18em] text-gray-500">默认桥接</div>
                  <div className="mt-2 text-gray-200">{item?.defaultBridgeTarget || '未参与本次流程'}</div>
                </div>
                <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                  <div className="uppercase tracking-[0.18em] text-gray-500">技能标签</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(item?.starterSkills || ['未参与']).map((skill) => (
                      <span key={`${roleId}-${skill}`} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-gray-300">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
