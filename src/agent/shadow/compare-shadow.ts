import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { compareShadowReport, loadShadowSignalWeightPolicy } from './comparator.js';
import type { ShadowRunReport } from './types.js';

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function parseArgs(argv: string[]) {
  const reportIndex = argv.indexOf('--report');
  const outIndex = argv.indexOf('--out');
  const policyIndex = argv.indexOf('--policy');

  return {
    reportPath:
      reportIndex >= 0 && argv[reportIndex + 1]
        ? path.resolve(argv[reportIndex + 1])
        : path.resolve(
            'F:\\openclaw-agent\\docs\\architecture\\LOBSTER_SHADOW_WITH_TRUTH_REPORT_2026-03-30.json',
          ),
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : null,
    policyPath:
      policyIndex >= 0 && argv[policyIndex + 1]
        ? path.resolve(argv[policyIndex + 1])
        : undefined,
  };
}

function main() {
  const { reportPath, outPath, policyPath } = parseArgs(process.argv.slice(2));
  const shadowReport = readJson<ShadowRunReport>(reportPath);
  const policy = loadShadowSignalWeightPolicy(policyPath);
  const comparison = compareShadowReport(shadowReport, policy);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(comparison, null, 2));
  }

  console.log(JSON.stringify(comparison, null, 2));
}

main();
