import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { createTargetHandlerRegistryWithMode } from './target-handlers.js';
import { buildTargetQueueConsumerReport, loadTargetQueueConsumerPolicy } from './target-queue-consumer.js';
import type { RuntimeTargetHandlerMode } from './types.js';

function parseArgs(argv: string[]) {
  const policyIndex = argv.indexOf('--policy');
  const outIndex = argv.indexOf('--out');
  const modeIndex = argv.indexOf('--mode');
  const bindIndex = argv.indexOf('--bind');

  return {
    policyPath:
      policyIndex >= 0 && argv[policyIndex + 1]
        ? path.resolve(argv[policyIndex + 1])
        : undefined,
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : null,
    mode:
      modeIndex >= 0 && argv[modeIndex + 1]
        ? (argv[modeIndex + 1] as RuntimeTargetHandlerMode)
        : 'simulated',
    bind:
      bindIndex >= 0 && argv[bindIndex + 1]
        ? argv[bindIndex + 1]
        : '',
  };
}

async function main() {
  const { policyPath, outPath, mode, bind } = parseArgs(process.argv.slice(2));
  const policy = loadTargetQueueConsumerPolicy(policyPath);
  const binds = bind
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const registry = createTargetHandlerRegistryWithMode({
    mode,
    binds,
    services: {
      leadOpsHandler: binds.includes('lead-ops') ? undefined : undefined,
      executeCampaignHandler: binds.includes('execute-campaign') ? undefined : undefined,
    },
  });
  const report = await buildTargetQueueConsumerReport(policy, registry, mode, binds);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(report, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
}

void main();
