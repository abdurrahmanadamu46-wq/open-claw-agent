import { promises as fs } from 'node:fs';
import path from 'node:path';

export type ReleaseGateSummary = {
  generated_at?: string;
  ok?: boolean;
  ui_smoke?: {
    ok?: boolean;
    exit_code?: number;
    artifact_dir?: string;
    summary?: string;
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
    exit_code?: number;
    artifact_dir?: string;
    summary?: string;
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
    exit_code?: number;
    artifact_dir?: string;
    summary?: string;
    report?: string;
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

export type FrontendCriticalSummary = {
  generated_at?: string;
  base_url?: string;
  artifact_dir?: string;
  results?: Array<{
    ok?: boolean;
    path?: string;
    label?: string;
    pageErrors?: string[];
    consoleErrors?: string[];
    responseErrors?: string[];
    checks?: string[];
  }>;
};

export type OperationsScanSummary = {
  generated_at?: string;
  total?: number;
  covered_count?: number;
  uncovered_count?: number;
  items?: Array<{
    route: string;
    score: number;
    coveredByScreenshot?: boolean;
    mojibakeHits?: string[];
    debugHits?: string[];
    hasStateHandling?: boolean;
  }>;
};

export type ReleaseDataLocalSummary = {
  generated_at?: string;
  runtime_mode?: string;
  notes?: string[];
  dragon?: {
    url?: string;
    ready?: boolean;
  };
  evidence?: {
    ok?: boolean;
    exit_code?: number;
    report?: string;
  };
};

export type ReleaseDataEvidenceSummary = {
  generated_at?: string;
  ok?: boolean;
  required_total?: number;
  required_passed?: number;
  optional_total?: number;
  optional_passed?: number;
};

export type FrontendCloseoutSummary = {
  generatedAt?: string;
  ok?: boolean;
  copyableSummary?: string;
  coverage?: {
    frontendCritical?: {
      passed?: number;
      total?: number;
      failed?: number;
    };
    operationsScan?: {
      covered?: number;
      total?: number;
      uncovered?: number;
      highPriorityIssues?: number;
    };
  };
  steps?: Array<{
    label: string;
    command: string;
    durationMs: number;
    exitCode: number;
    artifactDir?: string;
  }>;
  closeoutArtifacts?: {
    screenshotArtifactDir?: string;
    operationsScanArtifactDir?: string;
  };
};

export type LatestArtifactSummary<TSummary> = {
  artifact_name: string;
  artifact_dir: string;
  summary_path: string;
  report_path: string;
  summary: TSummary;
};

type ArtifactDirectory = {
  name: string;
  fullPath: string;
  mtimeMs: number;
};

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

async function getExistingArtifactRoots(): Promise<string[]> {
  const seen = new Set<string>();
  const roots: string[] = [];
  let current = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    const candidates = [
      path.join(current, 'test-results'),
      path.join(current, '.next-codex-build', 'standalone', 'test-results'),
      path.join(current, '.next', 'standalone', 'test-results'),
      path.join(current, '.next', 'standalone', '.next-codex-build', 'standalone', 'test-results'),
    ];

    for (const candidate of candidates) {
      const normalized = normalizePath(candidate);
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const stat = await fs.stat(candidate).catch(() => null);
      if (stat?.isDirectory()) roots.push(candidate);
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return roots;
}

async function findLatestArtifactDirectory(prefix: string): Promise<ArtifactDirectory | null> {
  return (await findLatestArtifactDirectoriesByPrefixes([prefix]))[0] ?? null;
}

async function findLatestArtifactDirectoryByPrefixes(prefixes: string[]): Promise<ArtifactDirectory | null> {
  return (await findLatestArtifactDirectoriesByPrefixes(prefixes))[0] ?? null;
}

async function findLatestArtifactDirectoriesByPrefixes(prefixes: string[]): Promise<ArtifactDirectory[]> {
  const roots = await getExistingArtifactRoots();
  return (
    await Promise.all(
      roots.map(async (root) => {
        const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
        return Promise.all(
          entries
            .filter(
              (entry) => entry.isDirectory() && prefixes.some((prefix) => entry.name.startsWith(prefix)),
            )
            .map(async (entry) => {
              const fullPath = path.join(root, entry.name);
              const stat = await fs.stat(fullPath).catch(() => null);
              return stat
                ? {
                    name: entry.name,
                    fullPath,
                    mtimeMs: stat.mtimeMs,
                  }
                : null;
            }),
        );
      }),
    )
  )
    .flat(2)
    .filter((entry): entry is ArtifactDirectory => Boolean(entry))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

async function readLatestArtifactSummary<TSummary>(
  prefix: string,
): Promise<LatestArtifactSummary<TSummary> | null> {
  const latestDirectories = await findLatestArtifactDirectoriesByPrefixes([prefix]);
  for (const latest of latestDirectories) {
    const summaryPath = path.join(latest.fullPath, 'summary.json');
    const reportPath = path.join(latest.fullPath, 'REPORT.md');
    const summaryRaw = await fs.readFile(summaryPath, 'utf8').catch(() => '');
    if (!summaryRaw) continue;

    return {
      artifact_name: latest.name,
      artifact_dir: normalizePath(latest.fullPath),
      summary_path: normalizePath(summaryPath),
      report_path: normalizePath(reportPath),
      summary: JSON.parse(summaryRaw) as TSummary,
    };
  }

  return null;
}

export async function readLatestReleaseGateSummary() {
  return readLatestArtifactSummary<ReleaseGateSummary>('release-gate-local-');
}

export async function readLatestFrontendCriticalSummary() {
  return readLatestArtifactSummary<FrontendCriticalSummary>('frontend-critical-screens-');
}

export async function readLatestOperationsScanSummary() {
  return readLatestArtifactSummary<OperationsScanSummary>('operations-surface-scan-');
}

export async function readLatestReleaseDataLocalSummary() {
  return readLatestArtifactSummary<ReleaseDataLocalSummary>('release-data-local-');
}

export async function readLatestReleaseDataEvidenceSummary() {
  return readLatestArtifactSummary<ReleaseDataEvidenceSummary>('release-data-evidence-');
}

export async function readLatestFrontendCloseoutSummary() {
  return readLatestArtifactSummary<FrontendCloseoutSummary>('frontend-closeout-');
}

export async function readLatestKnowledgeContextSummary() {
  const latestDirectories = await findLatestArtifactDirectoriesByPrefixes([
    'knowledge-context-local-',
    'knowledge-context-real-',
  ]);
  for (const latest of latestDirectories) {
    const summaryPath = path.join(latest.fullPath, 'summary.json');
    const reportPath = path.join(latest.fullPath, 'REPORT.md');
    const summaryRaw = await fs.readFile(summaryPath, 'utf8').catch(() => '');
    if (!summaryRaw) continue;

    return {
      artifact_name: latest.name,
      artifact_dir: normalizePath(latest.fullPath),
      summary_path: normalizePath(summaryPath),
      report_path: normalizePath(reportPath),
      summary: JSON.parse(summaryRaw) as Record<string, unknown>,
    };
  }

  return null;
}

export function summarizeFrontendCritical(summary?: FrontendCriticalSummary) {
  const results = summary?.results ?? [];
  return {
    passedPages: results.filter((item) => item.ok).length,
    totalPages: results.length,
    noisyPages: results.filter(
      (item) => (item.consoleErrors?.length ?? 0) > 0 || (item.responseErrors?.length ?? 0) > 0,
    ).length,
    pageErrors: results.reduce((count, item) => count + (item.pageErrors?.length ?? 0), 0),
    consoleErrors: results.reduce((count, item) => count + (item.consoleErrors?.length ?? 0), 0),
    responseErrors: results.reduce((count, item) => count + (item.responseErrors?.length ?? 0), 0),
  };
}

export function summarizeOperationsScan(summary?: OperationsScanSummary) {
  const items = summary?.items ?? [];
  const riskyItems = items.filter((item) => item.score > 0);
  return {
    totalPages: summary?.total ?? items.length,
    coveredPages: summary?.covered_count ?? items.filter((item) => item.coveredByScreenshot).length,
    uncoveredPages:
      summary?.uncovered_count ??
      items.filter((item) => !item.coveredByScreenshot).length,
    highPriorityItems: riskyItems.length,
    topRoutes: riskyItems
      .sort((left, right) => right.score - left.score || left.route.localeCompare(right.route))
      .slice(0, 5),
  };
}
