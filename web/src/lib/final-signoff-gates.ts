export type FinalSignoffGateStatus = 'blocked' | 'watch' | 'passed';

export type FinalSignoffGate = {
  id: string;
  title: string;
  owner: string;
  status: FinalSignoffGateStatus;
  summary: string;
  evidence: string;
};

export const FINAL_SIGNOFF_GATES: FinalSignoffGate[] = [
  {
    id: 'A-02',
    title: 'Execution monitor real-environment verification',
    owner: 'QA审核',
    status: 'blocked',
    summary: '本地 evidence 已齐，但真实 control-plane /ws/execution-logs 仍需 QA 最终签收。',
    evidence: 'docs/qa-evidence/A02_EXECUTION_MONITOR_LOCAL_EVIDENCE_2026-04-14',
  },
  {
    id: 'A-03',
    title: 'Group-collab frozen contract signoff',
    owner: 'QA审核 + AI群协作集成工程师',
    status: 'passed',
    summary: 'frozen contract、traceability 字段和后端本地闭环证据已齐。',
    evidence: 'backend/src/integrations/group-collab/FROZEN_CONTRACT.md',
  },
  {
    id: 'A-04',
    title: 'Demo skills freeze recognition',
    owner: 'Skills负责人 + 项目总控',
    status: 'watch',
    summary: 'freeze 已签字，当前主要剩发布流程认可。',
    evidence: 'packages/lobsters/SKILLS_FREEZE_SIGNOFF_2026-04-14.md',
  },
  {
    id: 'A-05',
    title: 'Knowledge boundary and consumer signoff',
    owner: 'QA审核 + 知识库优化负责人',
    status: 'passed',
    summary: 'tenant-private summaries 已能被知识库页、主管页、任务页消费，QA 与知识库侧已通过。',
    evidence: 'backend/test-results/group-collab-closeout-2026-04-13T15-20-02-463Z',
  },
];
