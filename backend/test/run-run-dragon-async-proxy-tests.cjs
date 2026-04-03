const assert = require('node:assert/strict');
const { AiSubserviceController } = require('../dist/ai-subservice/ai-subservice.controller.js');

async function main() {
  const controller = new AiSubserviceController({
    runDragonTeamAsync(payload) {
      return {
        ok: true,
        job_id: 'rdj_demo_01',
        status: 'queued',
        status_url: '/run-dragon-team-async/rdj_demo_01',
        request_id: 'req_demo_01',
        payload,
      };
    },
    getRunDragonTeamAsyncStatus(jobId) {
      return {
        ok: true,
        job_id: jobId,
        status: 'completed',
        request_id: 'req_demo_01',
        created_at: '2026-03-30T00:00:00Z',
        updated_at: '2026-03-30T00:00:02Z',
        user_id: 'admin_user',
        tenant_id: 'tenant_demo',
        result: { status: 'success', request_id: 'req_demo_01' },
      };
    },
  });

  const adminReq = { user: { tenantId: 'tenant_demo', roles: ['admin'], userId: 'admin_user' } };
  const accepted = await controller.runDragonTeamAsync(
    {
      task_description: 'Async commander task',
      competitor_handles: [],
      edge_targets: [],
      user_id: 'admin_user',
    },
    adminReq,
  );
  assert.equal(accepted.job_id, 'rdj_demo_01');
  assert.equal(accepted.status, 'queued');

  const status = await controller.runDragonTeamAsyncStatus('rdj_demo_01', adminReq);
  assert.equal(status.status, 'completed');
  assert.equal(status.result.status, 'success');

  console.log('run-dragon-async-proxy-tests: all tests passed');
}

main().catch((err) => {
  console.error('run-dragon-async-proxy-tests: failed');
  console.error(err);
  process.exit(1);
});
