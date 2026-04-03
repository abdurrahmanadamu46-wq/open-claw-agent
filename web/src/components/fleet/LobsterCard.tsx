'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { RemoteNode, RemoteNodePlatform } from '@/types';
import {
  getCabinetRole,
  getRoleStatusPhrase,
  type CabinetRoleId,
} from '@/types/cabinet';
import { SoulBadge } from './SoulBadge';

const STATUS_PHRASE_ROTATE_MS = 5000;

function formatPing(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '—';
  const sec = Math.floor((Date.now() - d) / 1000);
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  return `${Math.floor(sec / 3600)} 小时前`;
}

function platformBadge(p: string): string {
  const labels: Record<string, string> = {
    whatsapp: 'WhatsApp',
    wechat: 'WeChat',
    douyin: '抖音',
    telegram: 'Telegram',
    chrome: 'Chrome',
    other: '其他',
  };
  return labels[p] ?? p;
}

function LoadBar({ label, percent }: { label: string; percent: number }) {
  const p = Math.min(100, Math.max(0, percent));
  const color = p >= 85 ? '#ef4444' : p >= 60 ? '#E5A93D' : '#22c55e';
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-xs" style={{ color: '#94A3B8' }}>
        <span>{label}</span>
        <span>{p}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${p}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export interface LobsterCardProps {
  node: RemoteNode;
  /** 当前注入的灵魂角色 */
  activeRoleId: CabinetRoleId | undefined;
  onAssignSoul: (roleId: CabinetRoleId) => void;
  syncing?: boolean;
  /** 是否正在接收拖拽（高亮为投放区） */
  isDropTarget?: boolean;
  onDrop?: (roleId: CabinetRoleId) => void;
  onDragEnter?: () => void;
  onDragLeave?: () => void;
  /** 右上角 ⋯ 菜单 */
  menuOpen: boolean;
  onToggleMenu: () => void;
  onViewLogs: () => void;
  onForceOffline: () => void;
  onDispatch: () => void;
}

export function LobsterCard({
  node,
  activeRoleId,
  onAssignSoul,
  syncing = false,
  isDropTarget = false,
  onDrop,
  onDragEnter,
  onDragLeave,
  menuOpen,
  onToggleMenu,
  onViewLogs,
  onForceOffline,
  onDispatch,
}: LobsterCardProps) {
  const [tick, setTick] = useState(0);
  const role = getCabinetRole(activeRoleId);
  const soulStatusPhrase = role
    ? getRoleStatusPhrase(role, Math.floor(tick / STATUS_PHRASE_ROTATE_MS))
    : null;

  useEffect(() => {
    if (!role) return;
    const id = setInterval(() => setTick((t) => t + 1), STATUS_PHRASE_ROTATE_MS);
    return () => clearInterval(id);
  }, [role]);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    []
  );
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      onDragEnter?.();
    },
    [onDragEnter]
  );
  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      onDragLeave?.();
    },
    [onDragLeave]
  );
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      onDragLeave?.();
      const roleId = e.dataTransfer.getData('application/x-cabinet-role-id') as CabinetRoleId | undefined;
      if (roleId && onDrop) onDrop(roleId);
    },
    [onDrop, onDragLeave]
  );

  return (
    <motion.div
      layout
      className="relative rounded-xl border p-4 shadow-lg transition-colors duration-500"
      style={{
        backgroundColor: isDropTarget ? '#1e3a5f' : '#1E293B',
        borderColor: isDropTarget ? 'rgba(229,169,61,0.5)' : 'rgba(255,255,255,0.1)',
      }}
      onDragOver={onDrop ? handleDragOver : undefined}
      onDragEnter={onDrop ? handleDragEnter : undefined}
      onDragLeave={onDrop ? handleDragLeave : undefined}
      onDrop={onDrop ? handleDrop : undefined}
    >
      {/* 同步中遮罩 */}
      {syncing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-10 flex items-center justify-center rounded-xl"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
        >
          <span className="text-sm font-medium" style={{ color: '#E5A93D' }}>
            同步中…
          </span>
        </motion.div>
      )}

      <div className="absolute right-3 top-3 flex items-center gap-2">
        <SoulBadge
          activeRoleId={activeRoleId}
          onSelectRole={onAssignSoul}
          syncing={syncing}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMenu();
          }}
          className="rounded-lg px-2 py-1 text-lg leading-none transition hover:bg-white/10"
          style={{ color: '#94A3B8' }}
          aria-label="更多"
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full z-10 mt-1 min-w-[140px] rounded-lg border py-1 shadow-xl"
            style={{
              backgroundColor: '#0F172A',
              borderColor: 'rgba(255,255,255,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"
              style={{ color: '#F8FAFC' }}
              onClick={onViewLogs}
            >
              查看日志
            </button>
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"
              style={{ color: '#f87171' }}
              onClick={onForceOffline}
            >
              强行下线
            </button>
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"
              style={{ color: '#E5A93D' }}
              onClick={onDispatch}
            >
              下发新任务
            </button>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 pr-8">
        <span
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-500"
          style={{
            backgroundColor:
              node.status === 'ONLINE' ? '#22c55e' : node.status === 'BUSY' ? '#E5A93D' : '#ef4444',
          }}
          title={node.status}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium" style={{ color: '#F8FAFC' }}>
            {node.clientName}
          </h3>
          <p className="truncate font-mono text-xs" style={{ color: '#94A3B8' }}>
            {node.nodeId}
          </p>
          <p className="mt-1 text-xs" style={{ color: '#94A3B8' }}>
            心跳 {formatPing(node.lastPingAt)}
          </p>
        </div>
      </div>

      {/* 灵魂状态：已注魂时显示动态文案 */}
      {soulStatusPhrase && (
        <motion.p
          key={tick}
          initial={{ opacity: 0.6 }}
          animate={{ opacity: 1 }}
          className="mt-2 truncate text-xs"
          style={{ color: '#94A3B8' }}
        >
          正在「{role?.name}」：{soulStatusPhrase}
        </motion.p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {node.systemMetrics.platforms.length === 0 ? (
          <span className="text-xs" style={{ color: '#64748b' }}>
            无运行平台
          </span>
        ) : (
          node.systemMetrics.platforms.map((p) => (
            <span
              key={p}
              className="rounded-md px-2 py-0.5 text-xs"
              style={{ backgroundColor: 'rgba(198,106,40,0.2)', color: '#F8FAFC' }}
            >
              {platformBadge(p)}
            </span>
          ))
        )}
      </div>

      {node.currentAccountSummary && !soulStatusPhrase && (
        <p className="mt-2 truncate text-xs" style={{ color: '#94A3B8' }}>
          当前：{node.currentAccountSummary}
        </p>
      )}

      <div className="mt-3 space-y-2">
        <LoadBar label="CPU" percent={node.systemMetrics.cpuPercent} />
        <LoadBar label="内存" percent={node.systemMetrics.memoryPercent} />
      </div>

      <button
        type="button"
        onClick={onDispatch}
        className="mt-4 w-full rounded-lg border py-2 text-sm font-medium transition hover:bg-white/5"
        style={{ borderColor: 'rgba(198,106,40,0.5)', color: '#E5A93D' }}
      >
        下发新任务
      </button>
    </motion.div>
  );
}
