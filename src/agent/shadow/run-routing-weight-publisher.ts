import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { publishRoutingWeightPatch } from './routing-weight-publisher.js';
import type { PromotionGateReport } from './types.js';

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function parseArgs(argv: string[]) {
  const gateIndex = argv.indexOf('--gate');
  const outIndex = argv.indexOf('--out');
  const reportIndex = argv.indexOf('--report');

  return {
    gatePath:
      gateIndex >= 0 && argv[gateIndex + 1]
        ? path.resolve(argv[gateIndex + 1])
        : path.resolve(
            'F:\\openclaw-agent\\docs\\architecture\\LOBSTER_SHADOW_PROMOTION_GATE_2026-03-30.json',
          ),
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : undefined,
    reportPath:
      reportIndex >= 0 && argv[reportIndex + 1]
        ? path.resolve(argv[reportIndex + 1])
        : null,
  };
}

function main() {
  const { gatePath, outPath, reportPath } = parseArgs(process.argv.slice(2));
  const gateReport = readJson<PromotionGateReport>(gatePath);
  const { patchPath, patch } = publishRoutingWeightPatch(gateReport, outPath);

  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify({ patchPath, patch }, null, 2));
  }

  console.log(
    JSON.stringify(
      {
        publishVersion: 'lobster.routing-weight-publisher.v0.2',
        patchPath,
        patch,
      },
      null,
      2,
    ),
  );
}

main();
