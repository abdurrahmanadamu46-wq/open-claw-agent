const assert = require('node:assert/strict');
const { AutopilotMetricsService } = require('../dist/autopilot/autopilot-metrics.service.js');
const { AutopilotController } = require('../dist/autopilot/autopilot.controller.js');

class InMemoryRedis {
  constructor() {
    this.hashes = new Map();
  }

  multi() {
    const parent = this;
    const ops = [];
    const chain = {
      hincrby(key, field, increment) {
        ops.push(['hincrby', key, field, increment]);
        return chain;
      },
      expire(_key, _ttl) {
        ops.push(['expire']);
        return chain;
      },
      async exec() {
        for (const op of ops) {
          if (op[0] === 'hincrby') {
            const [, key, field, increment] = op;
            const hash = parent.hashes.get(key) ?? {};
            const prev = Number.parseInt(String(hash[field] ?? '0'), 10);
            hash[field] = String(prev + increment);
            parent.hashes.set(key, hash);
          }
        }
        return [];
      },
    };
    return chain;
  }

  async hgetall(key) {
    return this.hashes.get(key) ?? {};
  }
}

async function main() {
  const redis = new InMemoryRedis();
  const service = new AutopilotMetricsService({
    getOrThrow() {
      return redis;
    },
  });

  await service.recordQueueProcessFail({ tenantId: 'tenantA', queueName: 'radar_sniffing_queue' });
  await service.recordQueueProcessFail({ tenantId: 'tenantA', queueName: 'content_forge_queue' });
  await service.recordDlqEnqueue('tenantA', 'content_forge_queue');
  await service.recordReplayResult('tenantA', true, 'content_forge_queue');
  await service.recordReplayResult('tenantA', false, 'radar_sniffing_queue');

  const from = new Date(Date.now() - 2 * 60_000);
  const to = new Date(Date.now() + 2 * 60_000);

  const all = await service.getDashboardMetrics('tenantA', {
    from,
    to,
  });
  assert.equal(all.totals.queueProcessFail, 2);
  assert.equal(all.totals.dlqEnqueue, 1);
  assert.equal(all.totals.replayAttempt, 2);
  assert.equal(all.totals.replaySuccess, 1);
  assert.equal(all.totals.replayFailed, 1);
  assert.equal(all.byQueue.queueProcessFail.radar_sniffing_queue, 1);
  assert.equal(all.byQueue.queueProcessFail.content_forge_queue, 1);
  assert.equal(all.byQueue.dlqEnqueue.content_forge_queue, 1);

  const filtered = await service.getDashboardMetrics('tenantA', {
    from,
    to,
    sourceQueue: 'content_forge_queue',
  });
  assert.equal(filtered.totals.queueProcessFail, 1);
  assert.equal(filtered.totals.dlqEnqueue, 1);
  assert.equal(filtered.totals.replayAttempt, 1);
  assert.equal(filtered.totals.replaySuccess, 1);
  assert.equal(filtered.totals.replayFailed, 0);
  assert.equal(filtered.query.sourceQueue, 'content_forge_queue');

  const controller = new AutopilotController(
    {}, // coordinator
    {}, // circuit
    {}, // dlqService
    {}, // taskStateService
    {}, // taskControlService
    {}, // traceService
    service, // metricsService
  );
  const apiResult = await controller.getDashboardMetrics(
    '120',
    from.toISOString(),
    to.toISOString(),
    'content_forge_queue',
    { user: { tenantId: 'tenantA', roles: ['admin'], isAdmin: true } },
  );
  assert.equal(apiResult.ok, true);
  assert.equal(apiResult.totals.queueProcessFail, 1);
  assert.equal(apiResult.totals.dlqEnqueue, 1);
  assert.equal(apiResult.totals.replaySuccess, 1);
  assert.equal(apiResult.totals.replayFailed, 0);
  assert.equal(apiResult.query.sourceQueue, 'content_forge_queue');

  console.log('metrics-tests: all tests passed');
}

main().catch((err) => {
  console.error('metrics-tests: test failed');
  console.error(err);
  process.exit(1);
});
