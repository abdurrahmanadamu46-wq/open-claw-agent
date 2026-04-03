import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildScopeRolloutReport } from './scope-rollout-report.js';

function parseArgs(argv: string[]) {
  const outIndex = argv.indexOf('--out');
  const patchIndex = argv.indexOf('--patch');

  return {
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : null,
    patchPath:
      patchIndex >= 0 && argv[patchIndex + 1]
        ? path.resolve(argv[patchIndex + 1])
        : undefined,
  };
}

function main() {
  const { outPath, patchPath } = parseArgs(process.argv.slice(2));
  const report = buildScopeRolloutReport({
    routingPatchPath: patchPath,
  });

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(report, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
