const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '..');
const testResultsRoot = path.join(webRoot, 'test-results');

const docsToSync = [
  'docs/FINAL_RELEASE_SIGNOFF_PACKET_2026-04-13.md',
  'docs/KNOWLEDGE_CONTEXT_QA_RUNBOOK_2026-04-17.md',
  'docs/OPENCLAW_FRONTEND_DELIVERY_INDEX_2026-04-17.md',
  'docs/OPENCLAW_LEARNING_LOOP_FINAL_HANDOFF_2026-04-17.md',
  'docs/OPENCLAW_PROJECT_FINAL_CLOSEOUT_2026-04-17.md',
  'docs/RELEASE_CLOSEOUT_COMMAND_CENTER_2026-04-13.md',
];

function hasMojibakeText(value) {
  if (typeof value !== 'string') return false;
  return /[鍓缁閫鐢姝璇绉锛]/.test(value);
}

const artifactTypes = [
  {
    key: 'frontendCloseout',
    prefix: 'frontend-closeout-',
    required: true,
    isUsable: (summary) => summary?.ok === true && !hasMojibakeText(summary?.copyableSummary),
  },
  {
    key: 'releaseUiSmoke',
    prefix: 'release-ui-smoke-',
    required: true,
    isUsable: (summary) => {
      if (Array.isArray(summary?.failures)) return summary.failures.length === 0;
      const routes = Array.isArray(summary?.routeResults) ? summary.routeResults : [];
      const interactions = Array.isArray(summary?.interactions) ? summary.interactions : [];
      return routes.length > 0 && routes.every((item) => item?.ok) && interactions.every((item) => item?.ok);
    },
  },
  {
    key: 'releaseGate',
    prefix: 'release-gate-local-',
    required: true,
    isUsable: (summary) => summary?.ok === true,
  },
  {
    key: 'knowledgeContextReal',
    prefix: 'knowledge-context-real-',
    required: true,
    isUsable: (summary) => summary?.ok === true && summary?.mode === 'runtime_evidence',
  },
  {
    key: 'knowledgeContextLocal',
    prefix: 'knowledge-context-local-',
    required: true,
    isUsable: (summary) => summary?.ok === true || summary?.evidence?.ok === true,
  },
  {
    key: 'operationsSurfaceScan',
    prefix: 'operations-surface-scan-',
    required: true,
    isUsable: (summary) => Boolean(summary),
  },
  {
    key: 'frontendCriticalScreens',
    prefix: 'frontend-critical-screens-',
    required: true,
    isUsable: (summary) => {
      const results = Array.isArray(summary?.results) ? summary.results : [];
      return results.length > 0 && results.every((item) => item?.ok === true);
    },
  },
];

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function artifactTimestampPattern(prefix) {
  return `${escapeRegExp(prefix)}\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listArtifactDirs(prefix) {
  if (!fs.existsSync(testResultsRoot)) return [];
  return fs
    .readdirSync(testResultsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => {
      const fullPath = path.join(testResultsRoot, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        fullPath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function findLatestUsableArtifact(definition) {
  for (const candidate of listArtifactDirs(definition.prefix)) {
    const summaryPath = path.join(candidate.fullPath, 'summary.json');
    const summary = readJsonIfExists(summaryPath);
    if (!summary || !definition.isUsable(summary)) continue;
    return {
      ...candidate,
      summary,
      summaryPath,
      reportPath: path.join(candidate.fullPath, 'REPORT.md'),
      absPath: normalizePath(candidate.fullPath),
      relPath: normalizePath(path.relative(repoRoot, candidate.fullPath)),
    };
  }
  if (definition.required) {
    throw new Error(`No usable artifact found for ${definition.prefix}`);
  }
  return null;
}

function replaceArtifactReferences(content, definition, artifact) {
  const timestampPattern = artifactTimestampPattern(definition.prefix);
  const absolutePattern = new RegExp(`F:/openclaw-agent/web/test-results/${timestampPattern}`, 'g');
  const relativePattern = new RegExp(`web/test-results/${timestampPattern}`, 'g');
  return content
    .replace(absolutePattern, `F:/openclaw-agent/web/test-results/${artifact.name}`)
    .replace(relativePattern, `web/test-results/${artifact.name}`);
}

function syncDocs(artifactsByKey) {
  const artifactByPrefix = new Map(
    artifactTypes.map((definition) => [definition.prefix, artifactsByKey[definition.key]]),
  );
  const changes = [];

  for (const docRelPath of docsToSync) {
    const docPath = path.join(repoRoot, docRelPath);
    if (!fs.existsSync(docPath)) continue;
    const before = fs.readFileSync(docPath, 'utf8');
    let after = before;
    for (const definition of artifactTypes) {
      const artifact = artifactByPrefix.get(definition.prefix);
      if (!artifact) continue;
      after = replaceArtifactReferences(after, definition, artifact);
    }
    if (after !== before) {
      fs.writeFileSync(docPath, after, 'utf8');
      changes.push(docRelPath);
    }
  }

  return changes;
}

function validateReferences(artifactsByKey) {
  const missing = [];
  for (const [key, artifact] of Object.entries(artifactsByKey)) {
    if (!artifact) continue;
    const expected = [artifact.fullPath, artifact.summaryPath];
    if (key !== 'operationsSurfaceScan' && key !== 'frontendCriticalScreens') {
      expected.push(artifact.reportPath);
    }
    for (const item of expected) {
      if (!fs.existsSync(item)) missing.push(item);
    }
  }
  return missing;
}

function main() {
  const artifactsByKey = {};
  for (const definition of artifactTypes) {
    artifactsByKey[definition.key] = findLatestUsableArtifact(definition);
  }

  const changes = syncDocs(artifactsByKey);
  const missing = validateReferences(artifactsByKey);

  const result = {
    ok: missing.length === 0,
    changed_docs: changes,
    artifacts: Object.fromEntries(
      Object.entries(artifactsByKey).map(([key, artifact]) => [
        key,
        artifact
          ? {
              name: artifact.name,
              path: artifact.absPath,
            }
          : null,
      ]),
    ),
    missing,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main();
