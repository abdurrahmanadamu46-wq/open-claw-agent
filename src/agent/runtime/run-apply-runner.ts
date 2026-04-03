import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildRuntimeApplyRunnerReport } from './apply-runner.js';
import type { RuntimeWorkerAdapterReport } from './types.js';

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
            'F:\\openclaw-agent\\docs\\architecture\\LOBSTER_RUNTIME_WORKER_ADAPTER_2026-03-30.json',
          ),
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : null,
  };
}

async function main() {
  const { reportPath, outPath } = parseArgs(process.argv.slice(2));
  const adapterReport = readJson<RuntimeWorkerAdapterReport>(reportPath);
  const applyReport = await buildRuntimeApplyRunnerReport(adapterReport);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(applyReport, null, 2));
  }

  console.log(JSON.stringify(applyReport, null, 2));
}

void main();
