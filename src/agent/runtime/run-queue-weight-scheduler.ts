import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildRuntimeQueuePlan } from './queue-weight-scheduler.js';
import type { ShadowRunReport } from '../shadow/types.js';

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function parseArgs(argv: string[]) {
  const reportIndex = argv.indexOf('--report');
  const outIndex = argv.indexOf('--out');

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
  };
}

function main() {
  const { reportPath, outPath } = parseArgs(process.argv.slice(2));
  const report = readJson<ShadowRunReport>(reportPath);
  const queuePlan = buildRuntimeQueuePlan(report);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(queuePlan, null, 2));
  }

  console.log(JSON.stringify(queuePlan, null, 2));
}

main();
