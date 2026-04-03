const { spawnSync } = require('node:child_process');

function run(name, file) {
  const result = spawnSync(process.execPath, [file], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    throw new Error(`${name} failed with code ${result.status}`);
  }
}

function main() {
  run('metrics-tests', 'test/run-metrics-tests.cjs');
  run('alerts-tests', 'test/run-alerts-tests.cjs');
  run('log-audit-tests', 'test/run-log-audit-tests.cjs');
  run('redaction-tests', 'test/run-redaction-tests.cjs');
  run('resilience-tests', 'test/run-resilience-injection.cjs');
  // all passed if no throw
  console.log('observability-smoke: all checks passed');
}

try {
  main();
} catch (err) {
  console.error('observability-smoke: failed');
  console.error(err);
  process.exit(1);
}
