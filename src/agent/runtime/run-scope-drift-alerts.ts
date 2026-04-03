import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadScopeDriftAlertPolicy, buildScopeDriftAlertReport } from './scope-drift-alerts.js';
import type { ScopeRolloutTrendReport } from './scope-rollout-trend.js';

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function parseArgs(argv: string[]) {
  const trendIndex = argv.indexOf('--trend');
  const policyIndex = argv.indexOf('--policy');
  const outIndex = argv.indexOf('--out');
  const nowIndex = argv.indexOf('--now');
  const offsetIndex = argv.indexOf('--hours-offset');

  return {
    trendPath:
      trendIndex >= 0 && argv[trendIndex + 1]
        ? path.resolve(argv[trendIndex + 1])
        : path.resolve(
            'F:\\openclaw-agent\\docs\\architecture\\LOBSTER_SCOPE_ROLLOUT_TREND_2026-03-30.json',
          ),
    policyPath:
      policyIndex >= 0 && argv[policyIndex + 1]
        ? path.resolve(argv[policyIndex + 1])
        : undefined,
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : null,
    now:
      nowIndex >= 0 && argv[nowIndex + 1]
        ? new Date(argv[nowIndex + 1])
        : null,
    hoursOffset:
      offsetIndex >= 0 && argv[offsetIndex + 1]
        ? Number(argv[offsetIndex + 1])
        : null,
  };
}

function main() {
  const { trendPath, policyPath, outPath, now, hoursOffset } = parseArgs(process.argv.slice(2));
  const trend = readJson<ScopeRolloutTrendReport>(trendPath);
  const policy = loadScopeDriftAlertPolicy(policyPath);
  const effectiveNow =
    now && !Number.isNaN(now.getTime())
      ? now
      : hoursOffset !== null && Number.isFinite(hoursOffset)
        ? new Date(Date.now() + hoursOffset * 60 * 60 * 1000)
        : undefined;
  const report = buildScopeDriftAlertReport(trend, policy, {
    now: effectiveNow,
  });

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(report, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
