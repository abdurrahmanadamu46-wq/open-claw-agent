import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../');
const manifestPath = path.join(repoRoot, 'src/agent/runtime/config/owned-mirror-manifest.json');
const reportDir = path.join(repoRoot, 'docs/architecture');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureHardlink(primaryPath, mirrorPath) {
  await fs.mkdir(path.dirname(mirrorPath), { recursive: true });
  if (await exists(mirrorPath)) {
    await fs.unlink(mirrorPath);
  }
  await fs.link(primaryPath, mirrorPath);
}

async function run() {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const entries = [];

  for (const pair of manifest.pairs ?? []) {
    const primaryPath = path.join(repoRoot, pair.primary);
    const mirrorPath = path.join(repoRoot, pair.mirror);

    const primaryBuffer = await fs.readFile(primaryPath);
    const primaryHash = sha256(primaryBuffer);
    const mirrorExists = await exists(mirrorPath);
    const mirrorHash = mirrorExists ? sha256(await fs.readFile(mirrorPath)) : null;
    const wasDifferent = mirrorHash !== primaryHash;

    if (wasDifferent || !mirrorExists) {
      await fs.mkdir(path.dirname(mirrorPath), { recursive: true });
      await fs.writeFile(mirrorPath, primaryBuffer);
    }

    await ensureHardlink(primaryPath, mirrorPath);

    entries.push({
      id: pair.id,
      primary: pair.primary,
      mirror: pair.mirror,
      primaryHash,
      mirrorHashBefore: mirrorHash,
      wasDifferent,
      linked: true
    });
  }

  const report = {
    schemaVersion: 'lobster.owned-mirror-stabilization-report.v0.1',
    generatedAt: new Date().toISOString(),
    manifestPath: path.relative(repoRoot, manifestPath),
    pairCount: entries.length,
    entries
  };

  await fs.mkdir(reportDir, { recursive: true });
  const datedPath = path.join(reportDir, `LOBSTER_OWNED_MIRROR_STABILIZATION_${new Date().toISOString().slice(0, 10)}.json`);
  await fs.writeFile(datedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({ ok: true, reportPath: datedPath, pairCount: entries.length }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
