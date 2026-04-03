import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  deliverScopeDriftAlerts,
  loadScopeDriftAlertDeliveryPolicy,
} from './scope-drift-alert-delivery.js';
import type { RuntimeScopeDriftAlertReport } from './types.js';

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function parseArgs(argv: string[]) {
  const alertIndex = argv.indexOf('--alerts');
  const policyIndex = argv.indexOf('--policy');
  const outIndex = argv.indexOf('--out');
  const force = argv.includes('--force');

  return {
    alertPath:
      alertIndex >= 0 && argv[alertIndex + 1]
        ? path.resolve(argv[alertIndex + 1])
        : path.resolve(
            'F:\\openclaw-agent\\docs\\architecture\\LOBSTER_SCOPE_DRIFT_ALERTS_2026-03-30.json',
          ),
    policyPath:
      policyIndex >= 0 && argv[policyIndex + 1]
        ? path.resolve(argv[policyIndex + 1])
        : undefined,
    outPath:
      outIndex >= 0 && argv[outIndex + 1]
        ? path.resolve(argv[outIndex + 1])
        : null,
    force,
  };
}

function main() {
  const { alertPath, policyPath, outPath, force } = parseArgs(process.argv.slice(2));
  const alertReport = readJson<RuntimeScopeDriftAlertReport>(alertPath);
  const policy = loadScopeDriftAlertDeliveryPolicy(policyPath);
  const report = deliverScopeDriftAlerts(alertReport, policy, { force });

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(report, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
