const assert = require('node:assert/strict');
const { AiSubserviceController } = require('../dist/ai-subservice/ai-subservice.controller.js');

async function main() {
  const controller = new AiSubserviceController({
    getHitlPending(limit) {
      return { ok: true, count: 1, items: [{ approval_id: 'hitl_1' }], limit };
    },
    getHitlStatus(approvalId) {
      return { ok: true, approval_id: approvalId, status: { decision: 'pending' } };
    },
    decideHitl(payload) {
      return { approval_id: payload.approval_id, status: { decision: payload.decision, operator: payload.operator } };
    },
  });

  const adminReq = { user: { tenantId: 'tenant_demo', roles: ['admin'], userId: 'admin_user' } };
  const pending = await controller.getHitlPending(adminReq, '20');
  assert.equal(pending.ok, true);
  assert.equal(pending.items[0].approval_id, 'hitl_1');

  const status = await controller.getHitlStatus(adminReq, 'hitl_1');
  assert.equal(status.approval_id, 'hitl_1');

  const decision = await controller.decideHitl(adminReq, {
    approval_id: 'hitl_1',
    decision: 'approved',
    operator: 'boss',
    reason: 'looks good',
  });
  assert.equal(decision.status.decision, 'approved');
  assert.equal(decision.status.operator, 'boss');

  console.log('hitl-proxy-tests: all tests passed');
}

main().catch((err) => {
  console.error('hitl-proxy-tests: failed');
  console.error(err);
  process.exit(1);
});
