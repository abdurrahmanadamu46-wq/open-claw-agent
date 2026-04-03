const assert = require('node:assert/strict');

const {
  redisReadWithFallback,
  redisWriteOrBlock,
  RedisWriteBlockedError,
} = require('../dist/common/redis-resilience.js');
const { ActivationCodeService } = require('../dist/gateway/activation-code.service.js');

const logger = {
  warn() {},
  error() {},
};

async function testReadDegrade() {
  const fallback = { degraded: true };
  const result = await redisReadWithFallback(
    logger,
    'test-read',
    async () => {
      throw new Error('redis read down');
    },
    fallback,
  );
  assert.deepEqual(result, fallback);
}

async function testWriteBlock() {
  let caught = false;
  try {
    await redisWriteOrBlock(logger, 'test-write', async () => {
      throw new Error('redis write down');
    });
  } catch (err) {
    caught = true;
    assert.equal(err instanceof RedisWriteBlockedError, true);
    assert.match(err.message, /Redis write blocked/i);
  }
  assert.equal(caught, true, 'Expected RedisWriteBlockedError to be thrown');
}

async function testFailClosedActivationCode() {
  const redisService = {
    getOrThrow() {
      throw new Error('redis unavailable');
    },
  };
  const service = new ActivationCodeService(redisService);
  const result = await service.validateForConnection('CLAW-1234-ABCD-5678');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ACTIVATION_CODE_NOT_ALLOWED');
}

async function main() {
  await testReadDegrade();
  await testWriteBlock();
  await testFailClosedActivationCode();
  console.log('resilience-injection: all tests passed');
}

main().catch((err) => {
  console.error('resilience-injection: test failed');
  console.error(err);
  process.exit(1);
});

