const assert = require('node:assert/strict');
const { TenantRegistryService } = require('../dist/tenant-profiles/tenant-registry.service.js');

class FakeRedis {
  constructor() {
    this.kv = new Map();
    this.sets = new Map();
  }

  async get(key) {
    return this.kv.has(key) ? this.kv.get(key) : null;
  }

  async set(key, value) {
    this.kv.set(key, value);
    return 'OK';
  }

  async sadd(key, value) {
    const set = this.sets.get(key) ?? new Set();
    set.add(value);
    this.sets.set(key, set);
    return set.size;
  }

  async smembers(key) {
    return Array.from(this.sets.get(key) ?? []);
  }
}

async function main() {
  const fakeRedis = new FakeRedis();
  const service = new TenantRegistryService({
    getOrThrow() {
      return fakeRedis;
    },
  });

  const ensured = await service.ensureTenant('tenant_alpha', { name: 'Alpha', quota: 9 });
  assert.equal(ensured.id, 'tenant_alpha');
  assert.equal(ensured.name, 'Alpha');
  assert.equal(ensured.deploymentRegion, 'cn-shanghai');
  assert.equal(ensured.dataResidency, 'cn-mainland');

  const updated = await service.updateTenant('tenant_alpha', {
    businessKeywords: ['医美', '私域'],
    nodeWorkflowProgress: { S1: true, S3: true },
  });
  assert.deepEqual(updated.businessKeywords, ['医美', '私域']);
  assert.equal(updated.nodeWorkflowProgress.S1, true);
  assert.equal(updated.nodeWorkflowProgress.S3, true);
  assert.equal(updated.nodeWorkflowProgress.S2, false);

  await service.ensureTenant('tenant_beta', { name: 'Beta' });
  const adminView = await service.listTenants({ adminView: true, includeInactive: true });
  assert.equal(adminView.length, 2);

  const scopedView = await service.listTenants({ tenantScope: 'tenant_alpha', adminView: false });
  assert.equal(scopedView.length, 1);
  assert.equal(scopedView[0].id, 'tenant_alpha');

  const archived = await service.archiveTenant('tenant_beta');
  assert.equal(archived.inactive, true);
  assert.ok(archived.archivedAt);

  const activeOnly = await service.listTenants({ adminView: true, includeInactive: false });
  assert.equal(activeOnly.some((item) => item.id === 'tenant_beta'), false);

  console.log('tenant-registry-tests: all tests passed');
}

main().catch((err) => {
  console.error('tenant-registry-tests: failed');
  console.error(err);
  process.exit(1);
});
