import fs from 'node:fs';
import path from 'node:path';

import { resolveCommanderDecision } from './engine.js';

const outPath = process.argv.includes('--out')
  ? path.resolve(process.argv[process.argv.indexOf('--out') + 1] ?? '')
  : path.resolve('F:/openclaw-agent/docs/architecture/LOBSTER_BASELINE_AGENT_BINDING_SMOKE_2026-03-30.json');

const decision = resolveCommanderDecision({
  missionId: 'baseline-agent-binding-smoke',
  missionType: 'content_production',
  riskLevel: 'L2',
  latencyPriority: 'normal',
  revenueImpact: 'high',
  evidenceSufficiency: 'medium',
  requiresExternalAction: true,
  tags: ['baseline-agent-smoke', 'content'],
});

const report = {
  smokeVersion: 'lobster.baseline-agent-binding-smoke.v0.1',
  generatedAt: new Date().toISOString(),
  missionId: decision.missionId,
  missionType: decision.missionType,
  activeRoles: decision.activeRoles,
  prioritizedActiveRoles: decision.prioritizedActiveRoles,
  baselineAgentBindings: decision.baselineAgentBindings,
};

fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, outPath, boundRoleCount: report.baselineAgentBindings.length }, null, 2));
