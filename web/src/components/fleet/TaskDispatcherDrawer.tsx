'use client';

import { useState } from 'react';
import type { RemoteNode, TaskCommandActionType } from '@/types';
import { TASK_TEMPLATES, deployCommandToNode } from '@/services/node.service';
import { triggerSuccessToast, triggerErrorToast } from '@/services/api';

function platformIcon(p: string): string {
  const m: Record<string, string> = {
    whatsapp: 'WA',
    wechat: 'WX',
    douyin: 'DY',
    telegram: 'TG',
    chrome: 'Ch',
    other: '--',
  };
  return m[p] ?? '?';
}

type Props = {
  node: RemoteNode | null;
  open: boolean;
  onClose: () => void;
};

function commandsTopic(nodeId: string): string {
  return `clawcommerce/nodes/${nodeId}/commands`;
}

export function TaskDispatcherDrawer({ node, open, onClose }: Props) {
  const [templateId, setTemplateId] = useState<string>(TASK_TEMPLATES[0].id);
  const [sending, setSending] = useState(false);

  if (!open || !node) return null;

  const template = TASK_TEMPLATES.find((t) => t.id === templateId) ?? TASK_TEMPLATES[0];

  const handleDeploy = async () => {
    setSending(true);
    try {
      const command = await deployCommandToNode({
        targetNodeId: node.nodeId,
        actionType: template.actionType as TaskCommandActionType,
        payload: {
          templateId: template.id,
          templateLabel: template.label,
          action: template.actionType,
          campaignId: undefined,
        },
      });
      const suffix = command.status === 'PENDING' ? ' (node offline, queued)' : '';
      triggerSuccessToast(`Command dispatched${suffix}`);
      onClose();
    } catch {
      triggerErrorToast('Dispatch failed (check auth, tenant scope, or backend connectivity)');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-black/50 transition-opacity duration-300"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
        aria-hidden
        onClick={onClose}
      />
      <div
        className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-md flex-col border-l shadow-2xl transition-transform duration-300 ease-out"
        style={{
          backgroundColor: '#1E293B',
          borderColor: 'rgba(255,255,255,0.1)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <h2 className="text-lg font-semibold" style={{ color: '#F8FAFC' }}>
            Remote Task Dispatch
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-sm transition hover:bg-white/10"
            style={{ color: '#94A3B8' }}
            aria-label="Close"
          >
            x
          </button>
        </div>

        <div className="border-b px-5 py-4" style={{ borderColor: 'rgba(255,255,255,0.06)', backgroundColor: 'rgba(0,0,0,0.15)' }}>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: '#94A3B8' }}>
            Target Node / Route
          </p>
          <p className="mt-1 font-mono text-sm" style={{ color: '#E5A93D' }}>
            {node.nodeId}
          </p>
          <p className="mt-1 break-all font-mono text-[11px]" style={{ color: '#64748b' }}>
            {commandsTopic(node.nodeId)}
          </p>
          <p className="mt-1 text-sm" style={{ color: '#F8FAFC' }}>
            {node.clientName}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {node.systemMetrics.platforms.map((p) => (
              <span
                key={p}
                className="rounded px-2 py-0.5 text-xs"
                style={{ backgroundColor: 'rgba(198,106,40,0.25)', color: '#F8FAFC' }}
              >
                {platformIcon(p)} {p}
              </span>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <label className="mb-2 block text-sm font-medium" style={{ color: '#94A3B8' }}>
            Task Template
          </label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none claw-input-focus"
            style={{
              backgroundColor: '#0F172A',
              borderColor: 'rgba(255,255,255,0.15)',
              color: '#F8FAFC',
            }}
          >
            {TASK_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="border-t p-5" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <button
            type="button"
            disabled={sending}
            onClick={handleDeploy}
            className="w-full rounded-lg px-4 py-3 font-semibold text-white shadow-lg transition hover:opacity-95 disabled:opacity-50"
            style={{ background: 'var(--claw-gradient)' }}
          >
            {sending ? 'Dispatching...' : 'Dispatch to Node'}
          </button>
        </div>
      </div>
    </>
  );
}
