import path from 'node:path';

import { ingestRuntimeResults } from './result-feedback-ingestor.js';

function parseArgs(argv: string[]) {
  const baseIndex = argv.indexOf('--base-truth');
  const outIndex = argv.indexOf('--out');

  return {
    baseTruthPath:
      baseIndex >= 0 && argv[baseIndex + 1]
        ? path.resolve(argv[baseIndex + 1])
        : path.resolve(
            'F:\\openclaw-agent\\src\\agent\\shadow\\examples\\sample-truth-bundle.json',
          ),
    outputTruthPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : path.resolve(
            'F:\\openclaw-agent\\docs\\architecture\\LOBSTER_MERGED_TRUTH_BUNDLE_2026-03-30.json',
          ),
  };
}

function main() {
  const { baseTruthPath, outputTruthPath } = parseArgs(process.argv.slice(2));

  const report = ingestRuntimeResults({
    baseTruthPath,
    outputTruthPath,
    resultDirectories: [
      'F:\\openclaw-agent\\run\\lead-ops-results',
      'F:\\openclaw-agent\\run\\execute-campaign-results',
    ],
  });

  console.log(JSON.stringify(report, null, 2));
}

main();
