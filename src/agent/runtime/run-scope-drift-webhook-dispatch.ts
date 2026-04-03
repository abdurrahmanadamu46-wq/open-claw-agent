import { writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  dispatchScopeDriftWebhookOutbox,
  loadScopeDriftWebhookDispatchPolicy,
} from './scope-drift-webhook-dispatch.js';

function parseArgs(argv: string[]) {
  const policyIndex = argv.indexOf('--policy');
  const outIndex = argv.indexOf('--out');

  return {
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

async function main() {
  const { policyPath, outPath } = parseArgs(process.argv.slice(2));
  const policy = loadScopeDriftWebhookDispatchPolicy(policyPath);
  const report = await dispatchScopeDriftWebhookOutbox(policy);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(report, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
}

void main();
