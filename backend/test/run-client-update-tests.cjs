const assert = require('node:assert/strict');
const { createSign, generateKeyPairSync } = require('node:crypto');
const { ClientUpdateService } = require('../dist/client-update/client-update.service.js');

class FakeRedis {
  constructor() {
    this.strings = new Map();
  }

  async set(key, value) {
    this.strings.set(key, String(value));
    return 'OK';
  }

  async get(key) {
    return this.strings.get(key) ?? null;
  }
}

function buildSignaturePayload(input) {
  return [
    `platform=${input.platform}`,
    `channel=${input.channel}`,
    `version=${input.version}`,
    `downloadUrl=${input.downloadUrl}`,
    `sha256=${input.sha256}`,
    `minRequiredVersion=${input.minRequiredVersion || ''}`,
    `signatureKeyId=${input.signatureKeyId || ''}`,
  ].join('\n');
}

function withEnv(nextEnv, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(nextEnv)) {
    previous[key] = process.env[key];
    if (typeof value === 'undefined' || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (typeof value === 'undefined') delete process.env[key];
        else process.env[key] = value;
      }
    });
}

async function main() {
  await withEnv(
    {
      CLIENT_UPDATE_REQUIRE_SIGNATURE: '',
      CLIENT_UPDATE_SIGNATURE_KEYS_JSON: '',
      CLIENT_UPDATE_SIGNATURE_PUBLIC_KEY: '',
      CLIENT_UPDATE_SIGNATURE_PUBLIC_KEY_PATH: '',
      CLIENT_UPDATE_SIGNATURE_KEYS_PATH: '',
      CLIENT_UPDATE_SIGNATURE_DEFAULT_KEY_ID: '',
    },
    async () => {
      const fakeRedis = new FakeRedis();
      const redisService = { getOrThrow: () => fakeRedis };
      const service = new ClientUpdateService(redisService);

      await assert.rejects(
        () =>
          service.publishRelease({
            platform: 'win-x64',
            channel: 'stable',
            version: '1.2.0',
            downloadUrl: 'https://cdn.example.com/invalid.exe',
          }),
        /sha256 is required/,
      );

      const release = await service.publishRelease({
        platform: 'win-x64',
        channel: 'stable',
        version: '1.2.0',
        downloadUrl: 'https://cdn.example.com/vip-lobster-1.2.0.exe',
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        notes: 'stability improvements',
        publishedBy: 'ops',
        rollout: {
          percent: 0,
          tenantsAllowlist: ['tenant_whitelist'],
          tenantsDenylist: ['tenant_blocked'],
        },
      });
      assert.equal(release.version, '1.2.0');
      assert.equal(release.sha256, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      const checkWhitelist = await service.getLatest('win-x64', 'stable', '1.1.9', 'tenant_whitelist');
      assert.equal(checkWhitelist.hasUpdate, true);

      const checkBlocked = await service.getLatest('win-x64', 'stable', '1.1.9', 'tenant_blocked');
      assert.equal(checkBlocked.hasUpdate, false);

      const checkRandom = await service.getLatest('win-x64', 'stable', '1.1.9', 'tenant_random');
      assert.equal(checkRandom.hasUpdate, false);
    },
  );

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  await withEnv(
    {
      CLIENT_UPDATE_REQUIRE_SIGNATURE: 'true',
      CLIENT_UPDATE_SIGNATURE_KEYS_JSON: JSON.stringify({ k1: publicPem }),
      CLIENT_UPDATE_SIGNATURE_DEFAULT_KEY_ID: 'k1',
      CLIENT_UPDATE_SIGNATURE_PUBLIC_KEY: '',
      CLIENT_UPDATE_SIGNATURE_PUBLIC_KEY_PATH: '',
      CLIENT_UPDATE_SIGNATURE_KEYS_PATH: '',
    },
    async () => {
      const fakeRedis = new FakeRedis();
      const redisService = { getOrThrow: () => fakeRedis };
      const service = new ClientUpdateService(redisService);

      await assert.rejects(
        () =>
          service.publishRelease({
            platform: 'win-x64',
            channel: 'stable',
            version: '2.0.0',
            downloadUrl: 'https://cdn.example.com/vip-lobster-2.0.0.exe',
            sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          }),
        /signature is required by policy/,
      );

      const signInput = {
        platform: 'win-x64',
        channel: 'stable',
        version: '2.0.0',
        downloadUrl: 'https://cdn.example.com/vip-lobster-2.0.0.exe',
        sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        signatureKeyId: 'k1',
        minRequiredVersion: '',
      };
      const signer = createSign('RSA-SHA256');
      signer.update(buildSignaturePayload(signInput), 'utf8');
      signer.end();
      const signature = signer.sign(privatePem).toString('base64');

      const signedRelease = await service.publishRelease({
        ...signInput,
        signature,
        signatureAlgorithm: 'RSA-SHA256',
      });
      assert.equal(signedRelease.signatureKeyId, 'k1');

      await assert.rejects(
        () =>
          service.publishRelease({
            ...signInput,
            signature: signature.slice(0, -2) + 'ab',
            signatureAlgorithm: 'RSA-SHA256',
          }),
        /signature verification failed/,
      );
    },
  );

  console.log('client-update-tests: all tests passed');
}

main().catch((err) => {
  console.error('client-update-tests: failed');
  console.error(err);
  process.exit(1);
});
