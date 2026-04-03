const assert = require('node:assert/strict');
const { ActivationCodeService } = require('../dist/gateway/activation-code.service.js');
const { DeviceService } = require('../dist/device/device.service.js');

class FakeRedis {
  constructor() {
    this.hashes = new Map();
    this.sets = new Map();
    this.strings = new Map();
    this.zsets = new Map();
  }

  _hash(key) {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    return this.hashes.get(key);
  }

  _set(key) {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    return this.sets.get(key);
  }

  _zset(key) {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    return this.zsets.get(key);
  }

  async exists(key) {
    return this.hashes.has(key) || this.strings.has(key) ? 1 : 0;
  }

  async hget(key, field) {
    const hash = this.hashes.get(key);
    if (!hash) return null;
    return hash.get(field) ?? null;
  }

  async hgetall(key) {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    const out = {};
    for (const [k, v] of hash.entries()) out[k] = v;
    return out;
  }

  async get(key) {
    return this.strings.get(key) ?? null;
  }

  async zrevrange(key, start, end) {
    const z = this.zsets.get(key);
    if (!z) return [];
    const rows = Array.from(z.entries()).sort((a, b) => b[1] - a[1]).map(([member]) => member);
    const realEnd = end < 0 ? rows.length - 1 : end;
    return rows.slice(start, realEnd + 1);
  }

  multi() {
    const ops = [];
    const chain = {
      hset: (key, field, value) => {
        if (typeof field === 'object' && field !== null) {
          ops.push(() => {
            const hash = this._hash(key);
            for (const [k, v] of Object.entries(field)) hash.set(String(k), String(v));
          });
        } else {
          ops.push(() => this._hash(key).set(String(field), String(value ?? '')));
        }
        return chain;
      },
      zadd: (key, score, member) => {
        ops.push(() => this._zset(key).set(String(member), Number(score)));
        return chain;
      },
      sadd: (key, member) => {
        ops.push(() => this._set(key).add(String(member)));
        return chain;
      },
      expire: () => chain,
      exec: async () => {
        for (const op of ops) op();
        return [];
      },
    };
    return chain;
  }
}

async function main() {
  const fakeRedis = new FakeRedis();
  const redisService = { getOrThrow: () => fakeRedis };

  const activation = new ActivationCodeService(redisService);
  const created = await activation.createCode({ tenantId: 'tenantA', createdBy: 'ops' });
  assert.ok(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(created.code), 'code format should match XXXX-XXXX-XXXX-XXXX');

  const listed = await activation.listCodes('tenantA', 10);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].tenantId, 'tenantA');
  assert.equal(listed[0].status, 'ACTIVE');

  const revoked = await activation.setStatus(created.code, 'tenantA', 'REVOKED');
  assert.equal(revoked.status, 'REVOKED');
  const validationAfterRevoke = await activation.validateForConnection(created.code);
  assert.equal(validationAfterRevoke.ok, false);

  const created2 = await activation.createCode({ tenantId: 'tenantA' });
  const validationOk = await activation.validateForConnection(created2.code);
  assert.equal(validationOk.ok, true);
  assert.equal(validationOk.tenantId, 'tenantA');

  const deviceService = new DeviceService(redisService);
  await deviceService.upsertDevice({
    tenant_id: 'tenantA',
    machine_code: 'NODE-001',
    status: 'ONLINE',
  });
  const devices = await deviceService.listDevices('tenantA', 20);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].machine_code, 'NODE-001');
  assert.equal(devices[0].status, 'ONLINE');

  console.log('activation-device-tests: all tests passed');
}

main().catch((err) => {
  console.error('activation-device-tests: failed');
  console.error(err);
  process.exit(1);
});
