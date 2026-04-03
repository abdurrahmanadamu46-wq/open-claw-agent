const assert = require('node:assert/strict');
const { FleetWebSocketGateway } = require('../dist/gateway/fleet-websocket.gateway.js');
const { LeadService } = require('../dist/lead/lead.service.js');

class FakeRedis {
  constructor() {
    this.hashes = new Map();
    this.sets = new Map();
  }

  _getHash(key) {
    const existing = this.hashes.get(key);
    if (existing) return existing;
    const created = new Map();
    this.hashes.set(key, created);
    return created;
  }

  _getSet(key) {
    const existing = this.sets.get(key);
    if (existing) return existing;
    const created = new Set();
    this.sets.set(key, created);
    return created;
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
    for (const [field, value] of hash.entries()) out[field] = value;
    return out;
  }

  multi() {
    const ops = [];
    const self = this;
    const chain = {
      hset(key, field, value) {
        if (typeof field === 'object' && field !== null) {
          ops.push(() => {
            const hash = self._getHash(key);
            for (const [f, v] of Object.entries(field)) hash.set(String(f), String(v));
          });
        } else {
          ops.push(() => {
            const hash = self._getHash(key);
            hash.set(String(field), String(value ?? ''));
          });
        }
        return chain;
      },
      sadd(key, value) {
        ops.push(() => {
          self._getSet(key).add(String(value));
        });
        return chain;
      },
      expire() {
        return chain;
      },
      async exec() {
        for (const op of ops) op();
        return [];
      },
    };
    return chain;
  }
}

function createFakeSocket() {
  return {
    id: 'sock-1',
    handshake: {
      auth: { nodeId: 'node-1', tenantId: 'tenantA' },
      query: {},
      headers: {},
    },
    join() {},
    disconnect() {},
    emit() {},
  };
}

function createFakeServer() {
  const emitted = [];
  const server = {
    emitted,
    sockets: {
      sockets: new Map(),
    },
    to(target) {
      return {
        emit(event, payload) {
          emitted.push({ target, event, payload });
        },
      };
    },
  };
  return server;
}

async function main() {
  const fakeRedis = new FakeRedis();
  const redisService = { getOrThrow: () => fakeRedis };
  const leadService = new LeadService();
  const gateway = new FleetWebSocketGateway(redisService, leadService);
  const fakeServer = createFakeServer();
  gateway.server = fakeServer;

  const socket = createFakeSocket();
  gateway.handleConnection(socket);
  await gateway.handleNodePing(
    {
      nodeId: 'node-1',
      tenantId: 'tenantA',
      status: 'IDLE',
      traceId: 'trc_fleet_test',
    },
    socket,
  );

  await gateway.handleClientTaskAck(
    {
      task_id: 'task-001',
      campaign_id: 'camp-001',
      trace_id: 'trc_fleet_test',
      status: 'ACCEPTED',
      timestamp: Date.now(),
    },
    socket,
  );
  const taskHash = await fakeRedis.hgetall('fleet:task:task-001');
  assert.equal(taskHash.ackStatus, 'ACCEPTED');
  assert.equal(taskHash.campaignId, 'camp-001');
  assert.equal(taskHash.traceId, 'trc_fleet_test');

  await gateway.handleClientLeadReport(
    {
      campaign_id: 'camp-001',
      trace_id: 'trc_fleet_test',
      contact_info: '13812345678',
      intention_score: 89,
      source_platform: 'douyin',
      user_message: 'Need purchase link and pricing details',
    },
    socket,
  );
  const leadList = leadService.list('tenantA', { page: 1, limit: 20 });
  assert.ok(leadList.total >= 1);
  assert.equal(leadList.list[0].campaign_id, 'camp-001');
  assert.equal(leadList.list[0].contact_info, '138****5678');

  const dispatched = gateway.dispatchTask('node-1', {
    taskId: 'task-002',
    traceId: 'trc_fleet_test',
    campaignId: 'camp-001',
    actionType: 'UPLOAD_VIDEO',
    params: { file_url: 'https://cdn.example.com/video.mp4' },
    createdAt: new Date().toISOString(),
  });
  assert.equal(dispatched, true);
  const executeTaskEvent = fakeServer.emitted.find((item) => item.event === 'execute_task');
  const legacyDispatchEvent = fakeServer.emitted.find((item) => item.event === 'server.task.dispatch');
  assert.ok(executeTaskEvent, 'execute_task should be emitted');
  assert.ok(legacyDispatchEvent, 'legacy server.task.dispatch should be emitted');

  console.log('fleet-protocol-tests: all tests passed');
}

main().catch((err) => {
  console.error('fleet-protocol-tests: failed');
  console.error(err);
  process.exit(1);
});
