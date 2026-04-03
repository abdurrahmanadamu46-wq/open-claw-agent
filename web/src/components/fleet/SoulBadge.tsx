'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentIcon } from '@/components/agents/AgentIcon';
import {
  CABINET_ROLES,
  getCabinetRole,
  type CabinetRoleId,
  type CabinetRole,
} from '@/types/cabinet';

const CARD_STYLE = {
  backgroundColor: '#1E293B',
  borderColor: 'rgba(255,255,255,0.1)',
  accentBorder: 'rgba(229,169,61,0.5)',
  accentBg: 'rgba(229,169,61,0.12)',
};

interface SoulBadgeProps {
  /** 当前注入的角色 ID，空为待命 */
  activeRoleId: CabinetRoleId | undefined;
  /** 切换角色（注魂） */
  onSelectRole: (roleId: CabinetRoleId) => void;
  /** 是否正在同步到远端（显示 Syncing 态） */
  syncing?: boolean;
  disabled?: boolean;
}

export function SoulBadge({
  activeRoleId,
  onSelectRole,
  syncing = false,
  disabled = false,
}: SoulBadgeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const role = getCabinetRole(activeRoleId);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const label = syncing
    ? '同步中…'
    : role
      ? role.name
      : '待命 (Idle)';
  const isIdle = !role && !syncing;

  return (
    <div className="relative" ref={ref}>
      <motion.button
        type="button"
        onClick={() => !disabled && !syncing && setOpen((o) => !o)}
        disabled={disabled || syncing}
        className="soul-badge flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition"
        style={{
          backgroundColor: isIdle ? 'transparent' : CARD_STYLE.accentBg,
          borderColor: isIdle ? 'rgba(255,255,255,0.25)' : CARD_STYLE.accentBorder,
          borderStyle: isIdle ? 'dashed' : 'solid',
          color: '#F8FAFC',
        }}
        animate={{
          boxShadow: role && !syncing ? ['0 0 0 0 rgba(229,169,61,0.2)', '0 0 12px 2px rgba(229,169,61,0.25)', '0 0 0 0 rgba(229,169,61,0.2)'] : undefined,
        }}
        transition={{
          duration: 2,
          repeat: role && !syncing ? Infinity : 0,
          repeatType: 'reverse',
        }}
      >
        {isIdle ? (
          <span className="opacity-70" style={{ fontSize: '0.65rem' }}>◇</span>
        ) : (
          role && <AgentIcon name={role.icon} size={14} />
        )}
        <span className="truncate max-w-[120px]">{label}</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-20 mt-1 w-56 rounded-xl border py-1 shadow-xl"
            style={{
              backgroundColor: '#0F172A',
              borderColor: CARD_STYLE.borderColor,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1.5 text-xs font-medium" style={{ color: '#94A3B8' }}>
              选择灵魂 · 注魂
            </div>
            {CABINET_ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-white/10"
                style={{ color: '#F8FAFC' }}
                onClick={() => {
                  onSelectRole(r.id);
                  setOpen(false);
                }}
              >
                <AgentIcon name={r.icon} size={16} />
                <span className="truncate">{r.name}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
