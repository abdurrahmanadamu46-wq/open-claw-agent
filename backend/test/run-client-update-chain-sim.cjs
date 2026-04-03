const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } = require('node:fs');
const { createHash, createSign, generateKeyPairSync, randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
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

function runNodeScript(commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`child exited with code=${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

async function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'vip-update-chain-'));
  const binaryName = 'vip-lobster-9.9.9.exe';
  const binaryBuffer = randomBytes(2048);
  const binarySha = sha256Hex(binaryBuffer);
  const binaryPath = join(tempRoot, binaryName);
  writeFileSync(binaryPath, binaryBuffer);

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keyId = 'ci-key-v1';
  const repoRoot = join(process.cwd(), '..');
  let origin = '';

  let server;
  try {
    server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/downloads/' + binaryName) {
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': String(binaryBuffer.length),
        });
        res.end(binaryBuffer);
        return;
      }

      if (url.pathname === '/manifest/latest') {
        const downloadUrl = `${origin}/downloads/${binaryName}`;
        const signInput = {
          platform: 'win-x64',
          channel: 'stable',
          version: '9.9.9',
          downloadUrl,
          sha256: binarySha,
          signatureKeyId: keyId,
          minRequiredVersion: '',
        };
        const signer = createSign('RSA-SHA256');
        signer.update(buildSignaturePayload(signInput), 'utf8');
        signer.end();
        const signature = signer.sign(privatePem).toString('base64');
        const payload = {
          code: 0,
          data: {
            platform: 'win-x64',
            channel: 'stable',
            hasUpdate: true,
            release: {
              ...signInput,
              signature,
              signatureAlgorithm: 'RSA-SHA256',
            },
          },
        };
        const body = Buffer.from(JSON.stringify(payload));
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(body.length),
        });
        res.end(body);
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });

    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    assert.ok(port > 0, 'server should be listening');
    origin = `http://127.0.0.1:${port}`;

    const runner = await runNodeScript(['scripts/vip-build/vip-lobster-entry.cjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        UPDATE_CHECK_ONLY: 'true',
        APP_VERSION: '0.1.0',
        AUTO_UPDATE_MANIFEST_URL: `${origin}/manifest/latest?platform=win-x64&channel=stable`,
        AUTO_UPDATE_DOWNLOAD: 'true',
        AUTO_UPDATE_REQUIRE_SIGNATURE: 'true',
        AUTO_UPDATE_PUBLIC_KEYS_JSON: JSON.stringify({ [keyId]: publicPem }),
        AUTO_UPDATE_DEFAULT_KEY_ID: keyId,
        TENANT_ID: 'tenant_ci_release',
      },
    });

    const downloadedPath = join(repoRoot, 'updates', binaryName);
    assert.equal(existsSync(downloadedPath), true, 'downloaded update package should exist');
    const downloaded = readFileSync(downloadedPath);
    assert.equal(sha256Hex(downloaded), binarySha, 'downloaded package sha256 should match');
    assert.match(runner.stdout, /sha256 verified/i);

    rmSync(downloadedPath, { force: true });
    console.log('client-update-chain-sim: all tests passed');
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('client-update-chain-sim: failed');
  console.error(err);
  process.exit(1);
});
