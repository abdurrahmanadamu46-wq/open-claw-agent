export type LatestReleaseGateResponse = {
  artifact_dir: string;
  report_path: string;
  summary_path?: string;
  summary: {
    generated_at?: string;
    ok?: boolean;
    ui_smoke?: {
      ok?: boolean;
      report?: string;
      metrics?: {
        passed_routes?: number;
        total_routes?: number;
        passed_interactions?: number;
        total_interactions?: number;
        failures?: number;
      };
    };
    data_evidence?: {
      ok?: boolean;
      report?: string;
      runtime_mode?: string;
      dragon_url?: string;
      metrics?: {
        required_passed?: number;
        required_total?: number;
        optional_passed?: number;
        optional_total?: number;
      };
    };
    knowledge_evidence?: {
      ok?: boolean;
      report?: string;
      summary?: string;
      artifact_dir?: string;
      mode?: string;
      seed_strategy?: string | null;
      layer_counts?: {
        platform_common?: number;
        platform_industry?: number;
        tenant_private?: number;
      };
      checks?: {
        run_dragon_team_responded?: boolean;
        platform_common_present?: boolean;
        platform_industry_present?: boolean;
        tenant_private_layer_present?: boolean;
        tenant_private_nonzero_when_seeded?: boolean;
        raw_group_collab_trace_excluded?: boolean;
        tenant_private_summary_only?: boolean;
        platform_backflow_blocked?: boolean;
      };
    };
    frontend_closeout?: {
      ok?: boolean;
      generated_at?: string;
      artifact_dir?: string;
      summary?: string;
      report?: string;
      copyable_summary?: string;
      coverage?: {
        frontend_critical?: {
          passed?: number;
          total?: number;
          failed?: number;
        };
        operations_scan?: {
          covered?: number;
          total?: number;
          uncovered?: number;
          high_priority_issues?: number;
        };
      };
      steps?: Array<{
        label?: string;
        command?: string;
        duration_ms?: number;
        exit_code?: number;
        artifact_dir?: string;
      }>;
      closeout_artifacts?: {
        screenshot_artifact_dir?: string;
        operations_scan_artifact_dir?: string;
      };
    };
    notes?: string[];
  };
};

export type LatestKnowledgeEvidenceSnapshot = {
  available: boolean;
  ok: boolean;
  mode: string;
  seedStrategy: string;
  artifactDir: string;
  summaryPath: string;
  reportPath: string;
  platformCommon: number;
  platformIndustry: number;
  tenantPrivate: number;
  runResponded: boolean;
  rawTraceExcluded: string;
  summaryOnly: string;
  backflowBlocked: string;
  tenantPrivateNonzeroWhenSeeded: string;
};

export type LatestFrontendCloseoutSnapshot = {
  available: boolean;
  ok: boolean;
  generatedAt: string;
  artifactDir: string;
  summaryPath: string;
  reportPath: string;
  screenshotArtifactDir: string;
  operationsScanArtifactDir: string;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  frontendCriticalPassed: number;
  frontendCriticalTotal: number;
  frontendCriticalFailed: number;
  operationsScanCovered: number;
  operationsScanTotal: number;
  operationsScanUncovered: number;
  operationsScanHighPriorityIssues: number;
  copyableSummary: string;
  steps: Array<{
    label: string;
    command: string;
    durationMs: number;
    exitCode: number;
    artifactDir: string;
  }>;
};

export function resolveLatestKnowledgeEvidence(
  payload?: LatestReleaseGateResponse | null,
): LatestKnowledgeEvidenceSnapshot {
  const evidence = payload?.summary?.knowledge_evidence;
  if (!evidence) {
    return {
      available: false,
      ok: false,
      mode: '-',
      seedStrategy: '-',
      artifactDir: '',
      summaryPath: '',
      reportPath: '',
      platformCommon: 0,
      platformIndustry: 0,
      tenantPrivate: 0,
      runResponded: false,
      rawTraceExcluded: '-',
      summaryOnly: '-',
      backflowBlocked: '-',
      tenantPrivateNonzeroWhenSeeded: '-',
    };
  }

  return {
    available: true,
    ok: Boolean(evidence.ok),
    mode: String(evidence.mode || '-'),
    seedStrategy: String(evidence.seed_strategy || '-'),
    artifactDir: String(evidence.artifact_dir || ''),
    summaryPath: String(evidence.summary || ''),
    reportPath: String(evidence.report || ''),
    platformCommon: Number(evidence.layer_counts?.platform_common ?? 0) || 0,
    platformIndustry: Number(evidence.layer_counts?.platform_industry ?? 0) || 0,
    tenantPrivate: Number(evidence.layer_counts?.tenant_private ?? 0) || 0,
    runResponded: Boolean(evidence.checks?.run_dragon_team_responded),
    rawTraceExcluded: evidence.checks?.raw_group_collab_trace_excluded ? 'yes' : 'no',
    summaryOnly: evidence.checks?.tenant_private_summary_only ? 'yes' : 'no',
    backflowBlocked: evidence.checks?.platform_backflow_blocked ? 'yes' : 'no',
    tenantPrivateNonzeroWhenSeeded: evidence.checks?.tenant_private_nonzero_when_seeded ? 'yes' : 'no',
  };
}

export function resolveLatestFrontendCloseout(
  payload?: LatestReleaseGateResponse | null,
): LatestFrontendCloseoutSnapshot {
  const closeout = payload?.summary?.frontend_closeout;
  if (!closeout) {
    return {
      available: false,
      ok: false,
      generatedAt: '-',
      artifactDir: '',
      summaryPath: '',
      reportPath: '',
      screenshotArtifactDir: '',
      operationsScanArtifactDir: '',
      totalSteps: 0,
      passedSteps: 0,
      failedSteps: 0,
      frontendCriticalPassed: 0,
      frontendCriticalTotal: 0,
      frontendCriticalFailed: 0,
      operationsScanCovered: 0,
      operationsScanTotal: 0,
      operationsScanUncovered: 0,
      operationsScanHighPriorityIssues: 0,
      copyableSummary: '',
      steps: [],
    };
  }

  const steps = closeout.steps ?? [];
  const passedSteps = steps.filter((step) => Number(step.exit_code ?? 1) === 0).length;

  return {
    available: true,
    ok: Boolean(closeout.ok),
    generatedAt: String(closeout.generated_at || '-'),
    artifactDir: String(closeout.artifact_dir || ''),
    summaryPath: String(closeout.summary || ''),
    reportPath: String(closeout.report || ''),
    screenshotArtifactDir: String(closeout.closeout_artifacts?.screenshot_artifact_dir || ''),
    operationsScanArtifactDir: String(closeout.closeout_artifacts?.operations_scan_artifact_dir || ''),
    totalSteps: steps.length,
    passedSteps,
    failedSteps: Math.max(steps.length - passedSteps, 0),
    frontendCriticalPassed: Number(closeout.coverage?.frontend_critical?.passed ?? 0) || 0,
    frontendCriticalTotal: Number(closeout.coverage?.frontend_critical?.total ?? 0) || 0,
    frontendCriticalFailed: Number(closeout.coverage?.frontend_critical?.failed ?? 0) || 0,
    operationsScanCovered: Number(closeout.coverage?.operations_scan?.covered ?? 0) || 0,
    operationsScanTotal: Number(closeout.coverage?.operations_scan?.total ?? 0) || 0,
    operationsScanUncovered: Number(closeout.coverage?.operations_scan?.uncovered ?? 0) || 0,
    operationsScanHighPriorityIssues: Number(closeout.coverage?.operations_scan?.high_priority_issues ?? 0) || 0,
    copyableSummary: String(closeout.copyable_summary || ''),
    steps: steps.map((step) => ({
      label: String(step.label || '-'),
      command: String(step.command || '-'),
      durationMs: Number(step.duration_ms ?? 0) || 0,
      exitCode: Number(step.exit_code ?? 1),
      artifactDir: String(step.artifact_dir || ''),
    })),
  };
}

export async function fetchLatestReleaseGate() {
  const response = await fetch('/api/release-gate/latest', { cache: 'no-store' });
  const payload = (await response.json().catch(() => null)) as LatestReleaseGateResponse | { error?: string } | null;
  if (!response.ok || !payload || !('summary' in payload)) {
    throw new Error((payload && 'error' in payload && payload.error) || `release gate request failed (${response.status})`);
  }
  return payload;
}
