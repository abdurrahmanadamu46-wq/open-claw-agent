const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..');
const operationsRoot = path.join(webRoot, 'src', 'app', 'operations');
const captureScriptPath = path.join(webRoot, 'scripts', 'capture-critical-demo-screens.cjs');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = path.join(webRoot, 'test-results', `operations-surface-scan-${timestamp}`);

const suspiciousRunPattern = /[鍙鐭绉璇鏁杩鍓娌鏄璺鐢宸璁鏃閫寰鍏鑳閲鍐褰閾妫鍚鍦鐣绋绗]{4,}|[锛銆鈥]{1,}/g;
const debugPhrasePatterns = [
  /\bTODO\b/g,
  /\bFIXME\b/g,
  /\bplaceholder\s+(?:data|page|view|content|state|shell)\b/gi,
  /\bdummy\b/gi,
  /\bpreview-mock\b/gi,
  /\bMVP\b/g,
  /\bdebug\b/gi,
];

fs.mkdirSync(artifactDir, { recursive: true });

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() && entry.name === 'page.tsx' ? [fullPath] : [];
  });
}

function normalizeRouteFromFile(filePath) {
  const relative = path.relative(path.join(webRoot, 'src', 'app'), filePath).replace(/\\/g, '/');
  return `/${relative.replace(/\/page\.tsx$/, '')}`;
}

function readCoveredRoutes() {
  const source = fs.readFileSync(captureScriptPath, 'utf8');
  return Array.from(new Set(
    Array.from(source.matchAll(/path:\s*'([^']+)'/g))
      .map((match) => match[1])
      .filter((route) => route.startsWith('/operations/')),
  ));
}

function routePatternToRegex(routePattern) {
  const escaped = routePattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\[.+?\\\]/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

function isCoveredRoute(routePattern, coveredRoutes) {
  if (coveredRoutes.includes(routePattern)) return true;
  if (!routePattern.includes('[')) return false;
  const matcher = routePatternToRegex(routePattern);
  return coveredRoutes.some((route) => matcher.test(route));
}

function collectMatches(content, patterns) {
  const results = [];
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) results.push(...matches);
  }
  return results;
}

function hasStateHandling(content) {
  return ['SurfaceStateCard', 'EmptyState', 'EmptyCard', 'kind="empty"', 'kind="warn"', 'kind="error"', 'kind="loading"']
    .some((token) => content.includes(token));
}

function scoreItem(item) {
  let score = 0;
  if (!item.coveredByScreenshot) score += 3;
  if (item.mojibakeHits.length > 0) score += 4;
  if (item.debugHits.length > 0) score += 2;
  if (!item.coveredByScreenshot && !item.hasStateHandling) score += 1;
  return score;
}

function writeReport(items, coveredCount, uncoveredCount) {
  const sorted = [...items].sort((left, right) => right.score - left.score || left.route.localeCompare(right.route));
  const topRisk = sorted.filter((item) => item.score > 0).slice(0, 12);

  const lines = [
    '# Operations Surface Quality Scan',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Scanned pages: ${items.length}`,
    `Covered by screenshot evidence: ${coveredCount}`,
    `Not covered by screenshot evidence: ${uncoveredCount}`,
    '',
    '## Top Priority',
    '',
    ...(topRisk.length
      ? topRisk.flatMap((item) => [
          `- score ${item.score} ${item.route}`,
          `  - covered: ${item.coveredByScreenshot ? 'yes' : 'no'}`,
          `  - mojibake hits: ${item.mojibakeHits.length ? item.mojibakeHits.join(', ') : 'none'}`,
          `  - debug hits: ${item.debugHits.length ? item.debugHits.join(', ') : 'none'}`,
          `  - state handling: ${item.hasStateHandling ? 'yes' : 'no'}`,
        ])
      : ['- No high-priority static issues found.']),
    '',
    '## Full List',
    '',
    ...sorted.flatMap((item) => [
      `- ${item.route}`,
      `  - covered: ${item.coveredByScreenshot ? 'yes' : 'no'}`,
      `  - score: ${item.score}`,
      `  - mojibake hits: ${item.mojibakeHits.length ? item.mojibakeHits.join(', ') : 'none'}`,
      `  - debug hits: ${item.debugHits.length ? item.debugHits.join(', ') : 'none'}`,
      `  - state handling: ${item.hasStateHandling ? 'yes' : 'no'}`,
      `  - file: \`${item.relativeFile}\``,
    ]),
  ];

  fs.writeFileSync(path.join(artifactDir, 'REPORT.md'), `\uFEFF${lines.join('\n')}`, 'utf8');
}

function main() {
  const files = walk(operationsRoot);
  const coveredRoutes = readCoveredRoutes();

  const items = files.map((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const route = normalizeRouteFromFile(filePath);
    const mojibakeHits = Array.from(new Set(collectMatches(content, [suspiciousRunPattern]))).slice(0, 8);
    const debugHits = Array.from(new Set(collectMatches(content, debugPhrasePatterns))).slice(0, 8);
    const item = {
      route,
      relativeFile: path.relative(webRoot, filePath).replace(/\\/g, '/'),
      coveredByScreenshot: isCoveredRoute(route, coveredRoutes),
      mojibakeHits,
      debugHits,
      hasStateHandling: hasStateHandling(content),
    };
    return {
      ...item,
      score: scoreItem(item),
    };
  });

  const coveredCount = items.filter((item) => item.coveredByScreenshot).length;
  const uncoveredCount = items.length - coveredCount;

  fs.writeFileSync(path.join(artifactDir, 'summary.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    total: items.length,
    covered_count: coveredCount,
    uncovered_count: uncoveredCount,
    items,
  }, null, 2), 'utf8');
  writeReport(items, coveredCount, uncoveredCount);

  const topRisk = [...items]
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.route.localeCompare(right.route))
    .slice(0, 10);

  console.log(`Operations surface scan: ${items.length} pages, ${coveredCount} covered, ${uncoveredCount} uncovered`);
  console.log(`Artifact dir: ${artifactDir}`);
  if (topRisk.length) {
    console.log('Top risk routes:');
    for (const item of topRisk) {
      console.log(`- [${item.score}] ${item.route}`);
    }
  } else {
    console.log('No high-priority static issues found.');
  }
}

main();
