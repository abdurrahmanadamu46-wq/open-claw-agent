import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildLimitedLiveReport, loadLimitedLivePolicy } from './limited-live-executor.js';
import type { RuntimeWorkerAdapterReport } from './types.js';

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function parseArgs(argv: string[]) {
  const reportIndex = argv.indexOf('--report');
  const policyIndex = argv.indexOf('--policy');
  const outIndex = argv.indexOf('--out');

  return {
    reportPath:
      reportIndex >= 0 && argv[reportIndex + 1]
        ? path.resolve(argv[reportIndex + 1])
        : path.resolve(
            'F:\\openclaw-agent\\docs\\architecture\\LOBSTER_RUNTIME_WORKER_ADAPTER_2026-03-30.json',
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
  const { reportPath, policyPath, outPath } = parseArgs(process.argv.slice(2));
  const adapterReport = readJson<RuntimeWorkerAdapterReport>(reportPath);
  const policy = loadLimitedLivePolicy(policyPath);
  const liveReport = buildLimitedLiveReport(adapterReport, policy);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(liveReport, null, 2));
  }

  console.log(JSON.stringify(liveReport, null, 2));
}

main();
