const assert = require('node:assert/strict');
const { AutopilotAlertService } = require('../dist/autopilot/autopilot-alert.service.js');

class InMemoryRedis {
  constructor() {
    this.kv = new Map();
    this.expireAt = new Map();
  }

  cleanup() {
    const now = Date.now();
    for (const [k, ts] of this.expireAt.entries()) {
      if (ts <= now) {
        this.expireAt.delete(k);
        this.kv.delete(k);
      }
    }
  }

  async get(key) {
    this.cleanup();
    return this.kv.has(key) ? this.kv.get(key) : null;
  }

  async set(key, value, ...args) {
    this.cleanup();
    let exSeconds = null;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === 'EX') {
        exSeconds = Number.parseInt(String(args[i + 1] ?? '0'), 10);
        i++;
      } else if (arg === 'NX') {
        nx = true;
      }
    }
    if (nx && this.kv.has(key)) return null;
    this.kv.set(key, value);
    if (exSeconds && Number.isFinite(exSeconds) && exSeconds > 0) {
      this.expireAt.set(key, Date.now() + exSeconds * 1000);
    } else {
      this.expireAt.delete(key);
    }
    return 'OK';
  }
}

async function main() {
  process.env.AUTOPILOT_ALERT_QUEUE_FAIL_THRESHOLD = '2';
  process.env.AUTOPILOT_ALERT_DLQ_GROWTH_THRESHOLD = '2';
  process.env.AUTOPILOT_ALERT_REPLAY_MIN_ATTEMPTS = '1';
  process.env.AUTOPILOT_ALERT_REPLAY_SUCCESS_RATE_THRESHOLD = '0.9';
  process.env.AUTOPILOT_ALERT_SUPPRESSION_SECONDS_DEFAULT = '120';

  const redis = new InMemoryRedis();
  const gateway = {
    events: [],
    emitAutopilotAlert(message, payload) {
      this.events.push({ message, payload });
    },
  };
  const router = {
    calls: [],
    async routeSignal(input) {
      this.calls.push(input);
      return { routed: ['webhook'], failed: [] };
    },
  };
  const metricsState = {
    queueProcessFail: 3,
    dlqEnqueue: 3,
    replayAttempt: 2,
    replaySuccess: 1,
    replayFailed: 1,
    replaySuccessRate: 0.5,
  };
  const metricsService = {
    async getDashboardMetrics(tenantId, query) {
      return {
        tenantId,
        windowMinutes: query.windowMinutes ?? 60,
        query: { sourceQueue: query.sourceQueue, from: undefined, to: undefined },
        totals: { ...metricsState },
        byQueue: { queueProcessFail: {}, dlqEnqueue: {} },
      };
    },
  };
  const service = new AutopilotAlertService(
    metricsService,
    gateway,
    { getOrThrow() { return redis; } },
    router,
  );

  const first = await service.evaluate('tenantA', { windowMinutes: 60, emit: true });
  assert.equal(first.signals.filter((s) => s.state === 'fired').length, 3);
  assert.equal(gateway.events.length, 3, 'first evaluation should emit 3 alerts');
  assert.equal(router.calls.length, 3, 'first evaluation should route 3 alerts');

  const second = await service.evaluate('tenantA', { windowMinutes: 60, emit: true });
  assert.equal(second.signals.filter((s) => s.state === 'fired').length, 3);
  assert.equal(gateway.events.length, 3, 'same state should be deduped by state key');
  assert.equal(router.calls.length, 3, 'same state should not route again');

  metricsState.queueProcessFail = 0;
  metricsState.dlqEnqueue = 0;
  metricsState.replayAttempt = 2;
  metricsState.replaySuccess = 2;
  metricsState.replayFailed = 0;
  metricsState.replaySuccessRate = 1;
  const third = await service.evaluate('tenantA', { windowMinutes: 60, emit: true });
  assert.equal(third.signals.filter((s) => s.state === 'ok').length, 3);
  assert.equal(
    gateway.events.length,
    3,
    'state changed but still inside suppression window, should not emit',
  );
  assert.equal(router.calls.length, 3, 'state changed but suppressed, should not route');

  console.log('alerts-tests: all tests passed');
}

main().catch((err) => {
  console.error('alerts-tests: test failed');
  console.error(err);
  process.exit(1);
});

