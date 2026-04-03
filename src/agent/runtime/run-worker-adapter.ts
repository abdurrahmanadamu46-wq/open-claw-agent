import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildRuntimeWorkerAdapterReport } from './worker-adapter.js';
import type { RuntimeExecutorBridgeReport } from './types.js';

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
            'F:\\openclaw-agent\\docs\\architecture\\LOBSTER_RUNTIME_EXECUTOR_BRIDGE_2026-03-30.json',
          ),
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : null,
  };
}

function main() {
  const { reportPath, outPath } = parseArgs(process.argv.slice(2));
  const bridgeReport = readJson<RuntimeExecutorBridgeReport>(reportPath);
  const adapterReport = buildRuntimeWorkerAdapterReport(bridgeReport);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(adapterReport, null, 2));
  }

  console.log(JSON.stringify(adapterReport, null, 2));
}

main();
