import fs from 'node:fs';
import path from 'node:path';

import { getExecutableWorkflowById, listExecutableWorkflowCatalog } from './workflow-catalog.js';

const outPath = process.argv.includes('--out')
  ? path.resolve(process.argv[process.argv.indexOf('--out') + 1] ?? '')
  : path.resolve('F:/openclaw-agent/docs/architecture/LOBSTER_WORKFLOW_CATALOG_SMOKE_2026-03-30.json');

const catalog = listExecutableWorkflowCatalog();
const spotlightIds = [
  'wf_signal_scan',
  'wf_visual_production',
  'wf_edge_publish',
  'wf_lead_scoring',
  'wf_high_score_call',
  'wf_recovery_replay',
] as const;

const report = {
  smokeVersion: 'lobster.workflow-catalog-smoke.v0.1',
  generatedAt: new Date().toISOString(),
  workflowCount: catalog.length,
  workflowIds: catalog.map((item) => item.workflowId),
  spotlight: spotlightIds.map((workflowId) => {
    const workflow = getExecutableWorkflowById(workflowId);
    return {
      workflowId: workflow.workflowId,
      category: workflow.category,
      roles: workflow.roles,
      lineups: workflow.lineups,
      stageCount: workflow.stages.length,
      stages: workflow.stages.map((stage) => ({
        stageId: stage.stageId,
        ownerRole: stage.ownerRole,
        missionType: stage.missionType,
        bridgeTarget: stage.bridgeTarget,
        scopeId: stage.scopeId ?? null,
        approvalActions: stage.approvalActions,
      })),
      localKnowledgeBases: workflow.localKnowledgeBases,
      clawhubSkillHints: workflow.clawhubSkillHints,
    };
  }),
};

fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, outPath, workflowCount: report.workflowCount }, null, 2));
