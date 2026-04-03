const assert = require('node:assert/strict');
const { AutopilotController } = require('../dist/autopilot/autopilot.controller.js');

async function main() {
  const controller = new AutopilotController(
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {
      async searchLogs(tenantId, query) {
        return {
          tenantId,
          query: {
            from: query.from,
            to: query.to,
            errorsOnly: query.errorsOnly === true,
            sourceQueue: query.sourceQueue,
            module: query.module,
            level: query.level,
            nodeId: query.nodeId,
            traceId: query.traceId,
            keyword: query.keyword,
            limit: query.limit ?? 100,
          },
          total: 1,
          items: [
            {
              id: 'task:demo',
              ts: new Date().toISOString(),
              level: 'ERROR',
              module: 'DISPATCHER',
              nodeId: 'node-1',
              traceId: 'trc_demo',
              eventType: 'task.state.failed',
              message: 'worker failed',
              campaignId: 'camp-1',
              sourceQueue: 'matrix_dispatch_queue',
              taskId: 'task-1',
              stage: 'dispatch',
            },
          ],
        };
      },
    },
  );

  const req = { user: { tenantId: 'tenantA', roles: ['admin'], isAdmin: true } };
  const result = await controller.searchLogs(
    '2026-03-18T00:00:00.000Z',
    '2026-03-19T00:00:00.000Z',
    'true',
    'matrix_dispatch_queue',
    'DISPATCHER',
    'ERROR',
    'node-1',
    'trc_demo',
    'failed',
    '50',
    req,
  );

  assert.equal(result.ok, true);
  assert.equal(result.tenantId, 'tenantA');
  assert.equal(result.query.errorsOnly, true);
  assert.equal(result.query.sourceQueue, 'matrix_dispatch_queue');
  assert.equal(result.query.module, 'DISPATCHER');
  assert.equal(result.query.level, 'ERROR');
  assert.equal(result.query.nodeId, 'node-1');
  assert.equal(result.query.traceId, 'trc_demo');
  assert.equal(result.query.keyword, 'failed');
  assert.equal(result.query.limit, 50);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].eventType, 'task.state.failed');

  await assert.rejects(
    () =>
      controller.searchLogs(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { user: { tenantId: '', roles: ['admin'], isAdmin: true } },
      ),
    /tenant scope is required/,
  );

  console.log('log-audit-tests: all tests passed');
}

main().catch((err) => {
  console.error('log-audit-tests: test failed');
  console.error(err);
  process.exit(1);
});
