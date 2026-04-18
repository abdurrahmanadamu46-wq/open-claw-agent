import type { LatestKnowledgeEvidenceSnapshot } from '@/lib/release-gate-client';

export type KnowledgeEvidenceCommandItem = {
  label: string;
  command: string;
  note?: string;
};

export type KnowledgeEvidenceActionLink = {
  href: string;
  label: string;
  tone?: 'amber' | 'cyan' | 'emerald' | 'fuchsia' | 'indigo' | 'sky';
};

export const KNOWLEDGE_EVIDENCE_RUNBOOK_PATH = 'docs/KNOWLEDGE_CONTEXT_QA_RUNBOOK_2026-04-17.md';

export const KNOWLEDGE_EVIDENCE_COMMAND_ITEMS: readonly KnowledgeEvidenceCommandItem[] = [
  {
    label: '快速注入验证',
    command: 'cd web && npm run evidence:knowledge-context:local:context',
    note: '只验证 knowledge_context 注入与三层边界，不跑长图。',
  },
  {
    label: '完整运行时证据',
    command: 'cd web && npm run evidence:knowledge-context:local',
    note: '自动拉起本地 Python + backend，跑完整 runtime_evidence 并自动清理进程。',
  },
] as const;

export const KNOWLEDGE_EVIDENCE_COMMANDS = KNOWLEDGE_EVIDENCE_COMMAND_ITEMS.map((item) => item.command);

export const KNOWLEDGE_EVIDENCE_PASS_RULES = [
  'mode = runtime_evidence',
  'seed_strategy = collab_dispatch',
  'tenant_private > 0',
  'raw group-collab traces excluded = yes',
  'tenant_private summary only = yes',
  'platform backflow blocked = yes',
] as const;

export function getKnowledgeEvidenceArtifacts(snapshot: LatestKnowledgeEvidenceSnapshot): string[] {
  return [KNOWLEDGE_EVIDENCE_RUNBOOK_PATH, snapshot.reportPath || snapshot.artifactDir].filter(Boolean);
}

export function getKnowledgeEvidenceSnapshotText(snapshot: LatestKnowledgeEvidenceSnapshot): string {
  if (!snapshot.available) {
    return '当前还没有挂到 release gate 的知识证据样本，先跑 local runtime evidence 再回来刷新。';
  }
  return `当前最新样本：${snapshot.mode} / ${snapshot.seedStrategy} / tenant_private = ${snapshot.tenantPrivate}`;
}
