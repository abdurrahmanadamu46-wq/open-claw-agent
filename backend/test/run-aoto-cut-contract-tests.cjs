const assert = require('node:assert/strict');
const { AotoCutService } = require('../dist/subprojects/aoto-cut.service.js');

class FakeRedis {
  constructor() {
    this.kv = new Map();
    this.hashes = new Map();
    this.sorted = new Map();
  }

  async hset(key, mapping) {
    const row = this.hashes.get(key) ?? {};
    Object.assign(row, mapping);
    this.hashes.set(key, row);
    return 1;
  }

  async hgetall(key) {
    return this.hashes.get(key) ?? {};
  }

  async zadd(key, score, member) {
    const row = this.sorted.get(key) ?? [];
    row.push({ member, score });
    row.sort((a, b) => b.score - a.score);
    this.sorted.set(key, row);
    return row.length;
  }

  async zrevrange(key, start, end) {
    const row = this.sorted.get(key) ?? [];
    return row.slice(start, end + 1).map((item) => item.member);
  }

  async expire() {
    return 1;
  }
}

async function main() {
  const fakeRedis = new FakeRedis();
  const service = new AotoCutService({
    getOrThrow() {
      return fakeRedis;
    },
  });

  const contract = service.getContract();
  assert.equal(contract.subproject, 'Aoto Cut');
  assert.equal(contract.responsibility_mode, 'integration_only');
  assert.ok(contract.output_objects.includes('publish_ready_package'));

  const record = await service.ingestPackage({
    tenant_id: 'tenant_demo',
    package_type: 'publish_ready_package',
    trace_id: 'trace_aotocut_01',
    payload: {
      title: 'Local merchant video batch',
      media_items: [{ id: 1 }, { id: 2 }],
    },
    created_by: 'admin',
  });
  assert.equal(record.tenant_id, 'tenant_demo');
  assert.equal(record.package_type, 'publish_ready_package');
  assert.equal(record.summary.item_count, 2);

  const items = await service.listPackages({
    tenant_id: 'tenant_demo',
    package_type: 'publish_ready_package',
    limit: 20,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].package_id, record.package_id);

  console.log('aoto-cut-contract-tests: all tests passed');
}

main().catch((err) => {
  console.error('aoto-cut-contract-tests: failed');
  console.error(err);
  process.exit(1);
});
