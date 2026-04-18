const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const webRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(webRoot, 'test-results');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = path.join(outputRoot, `release-gate-local-${timestamp}`);

fs.mkdirSync(artifactDir, { recursive: true });

function writeJson(name, data) {
  const target = path.join(artifactDir, name);
  fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
  return target;
}

function writeText(name, text) {
  const target = path.join(artifactDir, name);
  fs.writeFileSync(target, text, 'utf8');
  return target;
}

function parseLastJsonObject(text) {
  const trimmed = String(text || '').trim();
  for (let index = trimmed.lastIndexOf('{'); index >= 0; index = trimmed.lastIndexOf('{', index - 1)) {
    const candidate = trimmed.slice(index);
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

function parseMarkedJson(text, marker) {
  const source = String(text || '');
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const payload = source.slice(markerIndex + marker.length).trim();
  return parseLastJsonObject(payload) || parseFirstJsonObject(payload);
}

function parseFirstJsonObject(text) {
  const source = String(text || '').trim();
  for (let index = source.indexOf('{'); index >= 0; index = source.indexOf('{', index + 1)) {
    const candidate = source.slice(index);
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function buildUiSmokeMetrics(summary) {
  if (!summary) {
    return {
      passed_routes: 0,
      total_routes: 0,
      passed_interactions: 0,
      total_interactions: 0,
      failures: 0,
    };
  }
  return {
    passed_routes: Array.isArray(summary.routeResults) ? summary.routeResults.filter((item) => item.ok).length : 0,
    total_routes: Array.isArray(summary.routeResults) ? summary.routeResults.length : 0,
    passed_interactions: Array.isArray(summary.interactions) ? summary.interactions.filter((item) => item.ok).length : 0,
    total_interactions: Array.isArray(summary.interactions) ? summary.interactions.length : 0,
    failures: Array.isArray(summary.failures) ? summary.failures.length : 0,
  };
}

function buildDataEvidenceMetrics(summary) {
  if (!summary) {
    return {
      required_passed: 0,
      required_total: 0,
      optional_passed: 0,
      optional_total: 0,
    };
  }
  return {
    required_passed: Number(summary.required_passed ?? 0) || 0,
    required_total: Number(summary.required_total ?? 0) || 0,
    optional_passed: Number(summary.optional_passed ?? 0) || 0,
    optional_total: Number(summary.optional_total ?? 0) || 0,
  };
}

function buildKnowledgeEvidenceSnapshot(localSummary, nestedSummary, artifacts) {
  const source = nestedSummary || {};
  const local = localSummary || {};
  const checks = source.checks || {};
  const layerCounts = source.layer_counts || {};
  const summaryPath = local.evidence?.summary || artifacts?.summary || '';
  const artifactDirFromSummary = summaryPath ? path.dirname(summaryPath) : '';

  return {
    ok: Boolean(local.evidence?.ok) && Boolean(source.ok),
    exit_code: Number(local.evidence?.exit_code ?? 1),
    artifact_dir: artifactDirFromSummary || artifacts?.artifact_dir || artifacts?.artifactDir || '',
    summary: summaryPath,
    report: local.evidence?.report || artifacts?.report || '',
    mode: source.mode || local.mode || '',
    seed_strategy: source.seed_strategy || null,
    layer_counts: {
      platform_common: Number(layerCounts.platform_common ?? 0) || 0,
      platform_industry: Number(layerCounts.platform_industry ?? 0) || 0,
      tenant_private: Number(layerCounts.tenant_private ?? 0) || 0,
    },
    checks: {
      run_dragon_team_responded: Boolean(checks.run_dragon_team_responded),
      platform_common_present: Boolean(checks.platform_common_present),
      platform_industry_present: Boolean(checks.platform_industry_present),
      tenant_private_layer_present: Boolean(checks.tenant_private_layer_present),
      tenant_private_nonzero_when_seeded: Boolean(checks.tenant_private_nonzero_when_seeded),
      raw_group_collab_trace_excluded: Boolean(checks.raw_group_collab_trace_excluded),
      tenant_private_summary_only: Boolean(checks.tenant_private_summary_only),
      platform_backflow_blocked: Boolean(checks.platform_backflow_blocked),
    },
  };
}

function writeReport(summary) {
  const lines = [
    '# Release Gate Local Report',
    '',
    `Generated at: ${summary.generated_at}`,
    `Overall result: ${summary.ok ? 'pass' : 'needs attention'}`,
    '',
    '## UI Smoke',
    '',
    `- result: ${summary.ui_smoke.ok ? 'pass' : 'fail'}`,
    `- routes: ${summary.ui_smoke.metrics.passed_routes}/${summary.ui_smoke.metrics.total_routes}`,
    `- interactions: ${summary.ui_smoke.metrics.passed_interactions}/${summary.ui_smoke.metrics.total_interactions}`,
    `- failures: ${summary.ui_smoke.metrics.failures}`,
    `- report: \`${summary.ui_smoke.report || 'n/a'}\``,
    '',
    '## Local Data Evidence',
    '',
    `- result: ${summary.data_evidence.ok ? 'pass' : 'fail'}`,
    `- required probes: ${summary.data_evidence.metrics.required_passed}/${summary.data_evidence.metrics.required_total}`,
    `- optional probes: ${summary.data_evidence.metrics.optional_passed}/${summary.data_evidence.metrics.optional_total}`,
    `- report: \`${summary.data_evidence.report || 'n/a'}\``,
    '',
    '## Knowledge Context Evidence',
    '',
    `- result: ${summary.knowledge_evidence.ok ? 'pass' : 'fail'}`,
    `- mode: ${summary.knowledge_evidence.mode || 'n/a'}`,
    `- seed strategy: ${summary.knowledge_evidence.seed_strategy || 'n/a'}`,
    `- layer counts: common ${summary.knowledge_evidence.layer_counts.platform_common} / industry ${summary.knowledge_evidence.layer_counts.platform_industry} / tenant ${summary.knowledge_evidence.layer_counts.tenant_private}`,
    ...(summary.knowledge_evidence.mode === 'knowledge_context_only'
      ? ['- note: routine release gate uses context-only knowledge boundary evidence; full runtime supervisor-consumption evidence remains tracked by the A-05 runtime artifact.']
      : []),
    `- report: \`${summary.knowledge_evidence.report || 'n/a'}\``,
    '',
    '## Delivery Doc Sync',
    '',
    `- result: ${summary.doc_sync.ok ? 'pass' : 'fail'}`,
    `- exit code: ${summary.doc_sync.exit_code}`,
    `- changed docs: ${summary.doc_sync.changed_docs.length ? summary.doc_sync.changed_docs.join(', ') : 'none'}`,
    `- report: \`${summary.doc_sync.report || 'n/a'}\``,
    '',
    '## Notes',
    '',
    ...(summary.notes.length ? summary.notes.map((item) => `- ${item}`) : ['- none']),
  ];

  const reportPath = path.join(artifactDir, 'REPORT.md');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}

async function runNodeScript(label, relativeScriptPath, env = process.env, args = []) {
  return new Promise((resolve) => {
    const scriptPath = path.join(webRoot, relativeScriptPath);
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: webRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      writeText(`${label}.out.log`, stdout);
      writeText(`${label}.err.log`, stderr);
      resolve({
        exitCode: Number(code ?? 1),
        stdout,
        stderr,
      });
    });
  });
}

async function main() {
  const notes = [];

  let uiRun = await runNodeScript('release-ui-smoke', path.join('e2e', 'release-ui-smoke.cjs'));
  let uiArtifacts = parseMarkedJson(uiRun.stdout, 'RELEASE_UI_SMOKE_ARTIFACTS=');
  let uiSummary = readJsonIfExists(uiArtifacts?.summary);
  let uiMetrics = buildUiSmokeMetrics(uiSummary);

  if (uiRun.exitCode !== 0) {
    notes.push('release-ui-smoke failed on the first attempt, so the gate retried once to filter out dev-server cold-start noise.');
    const retryRun = await runNodeScript('release-ui-smoke-retry', path.join('e2e', 'release-ui-smoke.cjs'));
    const retryArtifacts = parseMarkedJson(retryRun.stdout, 'RELEASE_UI_SMOKE_ARTIFACTS=');
    const retrySummary = readJsonIfExists(retryArtifacts?.summary);
    const retryMetrics = buildUiSmokeMetrics(retrySummary);

    if (retryRun.exitCode === 0) {
      uiRun = retryRun;
      uiArtifacts = retryArtifacts;
      uiSummary = retrySummary;
      uiMetrics = retryMetrics;
      notes.push('release-ui-smoke passed on the retry, so the gate accepted the warmed-up result.');
    } else {
      notes.push('release-ui-smoke still failed after retry. Check the UI smoke report and stdout/stderr logs.');
    }
  }

  const dataRun = await runNodeScript('release-data-local-evidence', path.join('scripts', 'release-data-local-evidence.cjs'));
  const dataArtifacts = parseLastJsonObject(dataRun.stdout);
  const dataLocalSummary = readJsonIfExists(dataArtifacts?.summary);
  const nestedDataSummary = readJsonIfExists(dataLocalSummary?.evidence?.report ? path.join(path.dirname(dataLocalSummary.evidence.report), 'summary.json') : '');
  const dataMetrics = buildDataEvidenceMetrics(nestedDataSummary);

  if (dataRun.exitCode !== 0) {
    notes.push('release-data-local-evidence did not pass. Check the local data evidence report and stdout/stderr logs.');
  }

  const knowledgeRun = await runNodeScript(
    'knowledge-context-local-evidence',
    path.join('scripts', 'knowledge-context-local-evidence.cjs'),
    process.env,
    ['--mode', 'context_only'],
  );
  const knowledgeArtifacts = parseLastJsonObject(knowledgeRun.stdout);
  const knowledgeLocalSummary = readJsonIfExists(knowledgeArtifacts?.summary);
  const nestedKnowledgeSummary = readJsonIfExists(knowledgeLocalSummary?.evidence?.summary);
  const knowledgeEvidence = buildKnowledgeEvidenceSnapshot(
    knowledgeLocalSummary,
    nestedKnowledgeSummary,
    knowledgeArtifacts,
  );
  if (knowledgeEvidence.mode === 'knowledge_context_only') {
    notes.push('knowledge-context-local-evidence ran in context-only mode for routine release gating; full runtime A-05 evidence remains a separate artifact.');
  }

  if (knowledgeRun.exitCode !== 0) {
    notes.push('knowledge-context-local-evidence did not pass. Check the knowledge context report and stdout/stderr logs.');
  }

  const summary = {
    generated_at: new Date().toISOString(),
    ok: uiRun.exitCode === 0 && dataRun.exitCode === 0 && knowledgeRun.exitCode === 0,
    ui_smoke: {
      ok: uiRun.exitCode === 0,
      exit_code: uiRun.exitCode,
      artifact_dir: uiArtifacts?.artifactDir || '',
      summary: uiArtifacts?.summary || '',
      report: uiArtifacts?.report || '',
      metrics: uiMetrics,
    },
    data_evidence: {
      ok: dataRun.exitCode === 0,
      exit_code: dataRun.exitCode,
      artifact_dir: dataArtifacts?.artifact_dir || '',
      summary: dataArtifacts?.summary || '',
      report: dataArtifacts?.report || '',
      metrics: dataMetrics,
      runtime_mode: dataLocalSummary?.runtime_mode || '',
      dragon_url: dataLocalSummary?.dragon?.url || '',
    },
    knowledge_evidence: knowledgeEvidence,
    doc_sync: {
      ok: false,
      exit_code: 1,
      changed_docs: [],
      report: '',
      artifacts: {},
    },
    notes,
  };

  let summaryPath = writeJson('summary.json', summary);
  let reportPath = writeReport(summary);

  const docSyncRun = await runNodeScript('sync-delivery-docs', path.join('scripts', 'sync-delivery-doc-samples.cjs'));
  const docSyncPayload = parseLastJsonObject(docSyncRun.stdout);
  summary.doc_sync = {
    ok: docSyncRun.exitCode === 0 && docSyncPayload?.ok === true,
    exit_code: docSyncRun.exitCode,
    changed_docs: Array.isArray(docSyncPayload?.changed_docs) ? docSyncPayload.changed_docs : [],
    report: '',
    artifacts: docSyncPayload?.artifacts || {},
  };
  if (!summary.doc_sync.ok) {
    notes.push('sync-delivery-docs did not pass. Check the sync-delivery-docs stdout/stderr logs.');
  }
  summary.ok = summary.ok && summary.doc_sync.ok;

  summaryPath = writeJson('summary.json', summary);
  reportPath = writeReport(summary);

  console.log(JSON.stringify({
    ok: summary.ok,
    artifact_dir: artifactDir,
    summary: summaryPath,
    report: reportPath,
  }, null, 2));

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
