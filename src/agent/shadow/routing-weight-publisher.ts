import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  PromotionGateReport,
  RoutingWeightPatch,
} from '../commander/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPatchPath = path.join(
  __dirname,
  '..',
  'commander',
  'config',
  'routing-weight.patch.json',
);

export function buildRoutingWeightPatch(
  gateReport: PromotionGateReport,
): RoutingWeightPatch {
  return {
    schemaVersion: 'lobster.routing-weight.patch.v0.2',
    generatedAt: new Date().toISOString(),
    sourceGateVersion: gateReport.gateVersion,
    policyVersion: gateReport.policyVersion,
    entries: gateReport.decisions.map((decision) => ({
      roleId: decision.roleId,
      priorityTier: decision.priorityTier,
      action: decision.action,
      recommendedShadowWeight: decision.recommendedShadowWeight,
      recommendedLiveWeight: decision.recommendedLiveWeight,
      rationale: decision.rationale,
      driftSignals: decision.driftSignals,
      scopeHints: decision.scopeHints?.map((scope) => ({
        scopeId: scope.scopeId,
        recommendedAction: scope.recommendedAction,
        recommendedShadowWeight: decision.recommendedShadowWeight,
        recommendedLiveWeight:
          scope.recommendedAction === 'promote_to_limited_live'
            ? Math.max(decision.recommendedLiveWeight, 0.15)
            : scope.recommendedAction === 'promote_with_guardrails'
              ? Math.max(decision.recommendedLiveWeight, 0.05)
              : 0,
        truthRecordCount: scope.truthRecordCount,
        positiveTruthWeight: scope.positiveTruthWeight,
        negativeTruthWeight: scope.negativeTruthWeight,
        netTruthWeight: scope.netTruthWeight,
        includedSignals: scope.includedSignals,
      })),
    })),
  };
}

export function publishRoutingWeightPatch(
  gateReport: PromotionGateReport,
  outPath?: string,
): { patchPath: string; patch: RoutingWeightPatch } {
  const patch = buildRoutingWeightPatch(gateReport);
  const patchPath = outPath ? path.resolve(outPath) : defaultPatchPath;

  writeFileSync(patchPath, JSON.stringify(patch, null, 2));

  return {
    patchPath,
    patch,
  };
}
