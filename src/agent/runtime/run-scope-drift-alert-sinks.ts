import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  loadScopeDriftAlertSinksPolicy,
  publishScopeDriftAlertSinks,
} from './scope-drift-alert-sinks.js';
import type { RuntimeScopeDriftAlertDeliveryReport } from './types.js';

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function parseArgs(argv: string[]) {
  const deliveryIndex = argv.indexOf('--delivery');
  const policyIndex = argv.indexOf('--policy');
  const outIndex = argv.indexOf('--out');

  return {
    deliveryPath:
      deliveryIndex >= 0 && argv[deliveryIndex + 1]
        ? path.resolve(argv[deliveryIndex + 1])
        : path.resolve(
            'F:\\openclaw-agent\\docs\\architecture\\LOBSTER_SCOPE_DRIFT_ALERT_DELIVERY_STALE_SIM_2026-03-30.json',
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
  const { deliveryPath, policyPath, outPath } = parseArgs(process.argv.slice(2));
  const deliveryReport = readJson<RuntimeScopeDriftAlertDeliveryReport>(deliveryPath);
  const policy = loadScopeDriftAlertSinksPolicy(policyPath);
  const report = publishScopeDriftAlertSinks(deliveryReport, policy);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(report, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
