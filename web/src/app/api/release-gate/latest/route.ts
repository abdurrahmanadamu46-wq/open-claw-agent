import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  readLatestFrontendCriticalSummary,
  readLatestFrontendCloseoutSummary,
  readLatestKnowledgeContextSummary,
  readLatestReleaseDataEvidenceSummary,
  readLatestReleaseDataLocalSummary,
  readLatestReleaseGateSummary,
  summarizeFrontendCritical,
  type ReleaseGateSummary,
} from '@/lib/delivery-evidence';

export const dynamic = 'force-dynamic';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

async function readLatestKnowledgeEvidence() {
  const latest = await readLatestKnowledgeContextSummary();
  if (!latest) return null;

  const wrapperSummaryPath = latest.summary_path;
  const wrapperSummaryRaw = await fs.readFile(wrapperSummaryPath, 'utf8').catch(() => '');
  if (!wrapperSummaryRaw) return null;

  const wrapperSummary = JSON.parse(wrapperSummaryRaw) as Record<string, any>;
  const nestedSummaryPath = String(wrapperSummary?.evidence?.summary || '').trim();
  const nestedSummaryRaw = nestedSummaryPath
    ? await fs.readFile(nestedSummaryPath, 'utf8').catch(() => '')
    : '';
  const nestedSummary = nestedSummaryRaw ? (JSON.parse(nestedSummaryRaw) as Record<string, any>) : null;
  const source = nestedSummary || wrapperSummary;
  const sourceSummaryPath = nestedSummaryPath || wrapperSummaryPath;
  const sourceArtifactDir = sourceSummaryPath ? path.dirname(sourceSummaryPath) : latest.artifact_dir;

  return {
    ok: Boolean(wrapperSummary?.evidence?.ok ?? source?.ok),
    exit_code: Number(wrapperSummary?.evidence?.exit_code ?? 1),
    artifact_dir: normalizePath(sourceArtifactDir),
    summary: normalizePath(sourceSummaryPath),
    report: normalizePath(String(wrapperSummary?.evidence?.report || path.join(sourceArtifactDir, 'REPORT.md'))),
    mode: String(source?.mode || wrapperSummary?.mode || ''),
    seed_strategy: source?.seed_strategy ?? null,
    layer_counts: {
      platform_common: Number(source?.layer_counts?.platform_common ?? 0) || 0,
      platform_industry: Number(source?.layer_counts?.platform_industry ?? 0) || 0,
      tenant_private: Number(source?.layer_counts?.tenant_private ?? 0) || 0,
    },
    checks: {
      run_dragon_team_responded: Boolean(source?.checks?.run_dragon_team_responded),
      platform_common_present: Boolean(source?.checks?.platform_common_present),
      platform_industry_present: Boolean(source?.checks?.platform_industry_present),
      tenant_private_layer_present: Boolean(source?.checks?.tenant_private_layer_present),
      tenant_private_nonzero_when_seeded: Boolean(source?.checks?.tenant_private_nonzero_when_seeded),
      raw_group_collab_trace_excluded: Boolean(source?.checks?.raw_group_collab_trace_excluded),
      tenant_private_summary_only: Boolean(source?.checks?.tenant_private_summary_only),
      platform_backflow_blocked: Boolean(source?.checks?.platform_backflow_blocked),
    },
  };
}

async function readFallbackReleaseGate(): Promise<{
  artifact_dir: string;
  summary_path: string;
  report_path: string;
  summary: ReleaseGateSummary;
} | null> {
  const [frontendCritical, frontendCloseout, releaseDataLocal, releaseDataEvidence] = await Promise.all([
    readLatestFrontendCriticalSummary(),
    readLatestFrontendCloseoutSummary(),
    readLatestReleaseDataLocalSummary(),
    readLatestReleaseDataEvidenceSummary(),
  ]);

  if (!frontendCritical && !frontendCloseout && !releaseDataLocal && !releaseDataEvidence) return null;

  const screenshotMetrics = summarizeFrontendCritical(frontendCritical?.summary);
  const uiSmokeOk = screenshotMetrics.totalPages > 0 && screenshotMetrics.passedPages === screenshotMetrics.totalPages;
  const dataEvidenceOk = Boolean(releaseDataEvidence?.summary.ok ?? releaseDataLocal?.summary.evidence?.ok);
  const generatedAt =
    releaseDataLocal?.summary.generated_at
    || releaseDataEvidence?.summary.generated_at
    || frontendCritical?.summary.generated_at;

  return {
    artifact_dir:
      releaseDataLocal?.artifact_dir
      || releaseDataEvidence?.artifact_dir
      || frontendCritical?.artifact_dir
      || '',
    summary_path:
      releaseDataLocal?.summary_path
      || releaseDataEvidence?.summary_path
      || frontendCritical?.summary_path
      || '',
    report_path:
      releaseDataLocal?.report_path
      || releaseDataEvidence?.report_path
      || frontendCritical?.report_path
      || '',
    summary: {
      generated_at: generatedAt,
      ok: uiSmokeOk && dataEvidenceOk,
      ui_smoke: frontendCritical
        ? {
            ok: uiSmokeOk,
            report: frontendCritical.report_path,
            metrics: {
              passed_routes: screenshotMetrics.passedPages,
              total_routes: screenshotMetrics.totalPages,
              passed_interactions: 0,
              total_interactions: 0,
              failures: screenshotMetrics.totalPages - screenshotMetrics.passedPages,
            },
          }
        : undefined,
      data_evidence: releaseDataLocal || releaseDataEvidence
        ? {
            ok: dataEvidenceOk,
            report:
              releaseDataLocal?.summary.evidence?.report
              || releaseDataEvidence?.report_path
              || releaseDataLocal?.report_path,
            runtime_mode: releaseDataLocal?.summary.runtime_mode,
            dragon_url: releaseDataLocal?.summary.dragon?.url,
            metrics: {
              required_passed: releaseDataEvidence?.summary.required_passed ?? 0,
              required_total: releaseDataEvidence?.summary.required_total ?? 0,
              optional_passed: releaseDataEvidence?.summary.optional_passed ?? 0,
              optional_total: releaseDataEvidence?.summary.optional_total ?? 0,
            },
          }
        : undefined,
      frontend_closeout: frontendCloseout
        ? {
            ok: Boolean(frontendCloseout.summary.ok),
            generated_at: frontendCloseout.summary.generatedAt,
            artifact_dir: frontendCloseout.artifact_dir,
            summary: frontendCloseout.summary_path,
            report: frontendCloseout.report_path,
            copyable_summary: frontendCloseout.summary.copyableSummary,
            coverage: {
              frontend_critical: {
                passed: frontendCloseout.summary.coverage?.frontendCritical?.passed,
                total: frontendCloseout.summary.coverage?.frontendCritical?.total,
                failed: frontendCloseout.summary.coverage?.frontendCritical?.failed,
              },
              operations_scan: {
                covered: frontendCloseout.summary.coverage?.operationsScan?.covered,
                total: frontendCloseout.summary.coverage?.operationsScan?.total,
                uncovered: frontendCloseout.summary.coverage?.operationsScan?.uncovered,
                high_priority_issues: frontendCloseout.summary.coverage?.operationsScan?.highPriorityIssues,
              },
            },
            steps: (frontendCloseout.summary.steps ?? []).map((step) => ({
              label: step.label,
              command: step.command,
              duration_ms: step.durationMs,
              exit_code: step.exitCode,
              artifact_dir: step.artifactDir,
            })),
            closeout_artifacts: {
              screenshot_artifact_dir: frontendCloseout.summary.closeoutArtifacts?.screenshotArtifactDir,
              operations_scan_artifact_dir: frontendCloseout.summary.closeoutArtifacts?.operationsScanArtifactDir,
            },
          }
        : undefined,
      notes: [
        'Latest release-gate-local summary is missing, so the gate response is synthesized from frontend screenshot evidence and release-data evidence.',
        ...(releaseDataLocal?.summary.notes ?? []),
      ],
    },
  };
}

export async function GET() {
  const latest = (await readLatestReleaseGateSummary()) ?? (await readFallbackReleaseGate());
  if (!latest) {
    return NextResponse.json(
      {
        ok: true,
        artifact_dir: '',
        summary_path: '',
        report_path: '',
        summary: {
          generated_at: new Date().toISOString(),
          ok: false,
          notes: [
            'Release gate artifacts are not available yet. Run release evidence or screenshot evidence first, then refresh.',
          ],
        },
      },
      { status: 200 },
    );
  }

  const knowledgeEvidence = latest.summary.knowledge_evidence ?? (await readLatestKnowledgeEvidence());

  return NextResponse.json({
    ok: true,
    artifact_dir: latest.artifact_dir,
    summary_path: latest.summary_path,
    report_path: latest.report_path,
    summary: {
      ...latest.summary,
      ...(knowledgeEvidence ? { knowledge_evidence: knowledgeEvidence } : {}),
    },
  });
}
