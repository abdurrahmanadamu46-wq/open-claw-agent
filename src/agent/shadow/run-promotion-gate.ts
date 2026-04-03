import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadPromotionGatePolicy, runPromotionGate } from './promotion-gate.js';
import type { ShadowComparisonReport } from './types.js';

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function parseArgs(argv: string[]) {
  const compareIndex = argv.indexOf('--compare');
  const policyIndex = argv.indexOf('--policy');
  const outIndex = argv.indexOf('--out');

  return {
    comparePath:
      compareIndex >= 0 && argv[compareIndex + 1]
        ? path.resolve(argv[compareIndex + 1])
        : path.resolve(
            'F:\\openclaw-agent\\docs\\architecture\\LOBSTER_SHADOW_COMPARISON_2026-03-30.json',
          ),
    policyPath:
      policyIndex >= 0 && argv[policyIndex + 1]
        ? path.resolve(argv[policyIndex + 1])
        : undefined,
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : null,
  };
}

function main() {
  const { comparePath, policyPath, outPath } = parseArgs(process.argv.slice(2));
  const compareReport = readJson<ShadowComparisonReport>(comparePath);
  const policy = loadPromotionGatePolicy(policyPath);
  const gateReport = runPromotionGate(compareReport, policy);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(gateReport, null, 2));
  }

  console.log(JSON.stringify(gateReport, null, 2));
}

main();
