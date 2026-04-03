'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CustomLobsterAgent } from '@/data/custom-lobster-agents';

const GLOW = '0 0 20px rgba(0,212,255,0.35), 0 0 40px rgba(229,169,61,0.15)';
const BORDER_GLOW = 'rgba(0,212,255,0.4)';

export interface AgentDetailDrawerProps {
  agent: CustomLobsterAgent | null;
  open: boolean;
  onClose: () => void;
}

type TabId = 'personality' | 'skills';

export function AgentDetailDrawer({ agent, open, onClose }: AgentDetailDrawerProps) {
  const [tab, setTab] = useState<TabId>('personality');

  return (
    <AnimatePresence>
      {open && agent && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l shadow-2xl"
            style={{
              backgroundColor: '#0B0F1A',
              borderColor: BORDER_GLOW,
              boxShadow: GLOW,
            }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3" style={{ backgroundColor: '#0B0F1A', borderColor: 'rgba(255,255,255,0.08)' }}>
              <h2 className="text-lg font-semibold" style={{ color: '#F8FAFC' }}>
                {agent.name}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div className="p-4">
              {/* Avatar + 胸牌 */}
              <div className="mb-6 flex flex-col items-center">
                <div
                  className="mb-3 flex h-28 w-28 items-center justify-center rounded-full border-2 text-6xl"
                  style={{
                    backgroundColor: '#111827',
                    borderColor: BORDER_GLOW,
                    boxShadow: `inset 0 0 30px rgba(0,0,0,0.5), ${GLOW}`,
                  }}
                >
                  {agent.icon}
                </div>
                <span
                  className="rounded-full border px-3 py-1 text-xs font-medium"
                  style={{
                    color: '#94A3B8',
                    borderColor: 'rgba(229,169,61,0.5)',
                    backgroundColor: 'rgba(229,169,61,0.08)',
                  }}
                >
                  {agent.codename}
                </span>
              </div>

              <p className="mb-6 text-center text-sm" style={{ color: '#94A3B8' }}>
                {agent.description}
              </p>

              {/* Tabs */}
              <div className="mb-4 flex gap-2 rounded-lg p-1" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                <button
                  type="button"
                  onClick={() => setTab('personality')}
                  className="flex-1 rounded-md py-2 text-sm font-medium transition"
                  style={{
                    color: tab === 'personality' ? '#F8FAFC' : '#64748b',
                    backgroundColor: tab === 'personality' ? 'rgba(0,212,255,0.12)' : 'transparent',
                  }}
                >
                  角色性格
                </button>
                <button
                  type="button"
                  onClick={() => setTab('skills')}
                  className="flex-1 rounded-md py-2 text-sm font-medium transition"
                  style={{
                    color: tab === 'skills' ? '#F8FAFC' : '#64748b',
                    backgroundColor: tab === 'skills' ? 'rgba(229,169,61,0.12)' : 'transparent',
                  }}
                >
                  专属技能
                </button>
              </div>

              {tab === 'personality' && (
                <motion.div
                  key="personality"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border p-4"
                  style={{
                    backgroundColor: 'rgba(15,23,42,0.8)',
                    borderColor: 'rgba(255,255,255,0.08)',
                  }}
                >
                  <p className="text-sm leading-relaxed" style={{ color: '#E2E8F0' }}>
                    {agent.personality}
                  </p>
                </motion.div>
              )}

              {tab === 'skills' && (
                <motion.div
                  key="skills"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-2"
                >
                  {agent.skills.map((skill, i) => (
                    <div
                      key={skill}
                      className="flex items-center gap-3 rounded-lg border px-4 py-3"
                      style={{
                        backgroundColor: 'rgba(30,41,59,0.6)',
                        borderColor: 'rgba(229,169,61,0.25)',
                      }}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: 'rgba(229,169,61,0.2)', color: '#E5A93D' }}>
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium" style={{ color: '#F8FAFC' }}>
                        {skill}
                      </span>
                    </div>
                  ))}
                </motion.div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
