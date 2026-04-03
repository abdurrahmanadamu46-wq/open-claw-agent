import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { simulationMissionBatch, type DecisionContext } from '../commander/index.js';
import { runShadowMissions } from './runner.js';
import { loadShadowTruthBundle } from './truth-adapter.js';

function parseArgs(argv: string[]) {
  const outIndex = argv.indexOf('--out');
  const missionFileIndex = argv.indexOf('--missions');
  const truthFileIndex = argv.indexOf('--truth');
  const allowNonReady = argv.includes('--include-non-ready');

  return {
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : null,
    missionFile:
      missionFileIndex >= 0 && argv[missionFileIndex + 1]
        ? path.resolve(argv[missionFileIndex + 1])
        : null,
    truthFile:
      truthFileIndex >= 0 && argv[truthFileIndex + 1]
        ? path.resolve(argv[truthFileIndex + 1])
        : null,
    allowNonReady,
  };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function main() {
  const { outPath, missionFile, truthFile, allowNonReady } = parseArgs(process.argv.slice(2));
  const missions: DecisionContext[] = missionFile
    ? readJson<DecisionContext[]>(missionFile)
    : simulationMissionBatch;
  const normalizedTruthFile = truthFile || undefined;
  const truthBundle = loadShadowTruthBundle(normalizedTruthFile);

  const report = runShadowMissions({
    missions,
    onlyShadowReady: !allowNonReady,
    truthBundle,
  });

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(report, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
