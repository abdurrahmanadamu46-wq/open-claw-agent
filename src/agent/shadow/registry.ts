import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LobsterRegistryEntry, LobsterRoleCard } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const registryPath = path.join(repoRoot, 'packages', 'lobsters', 'registry.json');

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function loadLobsterRegistry(): LobsterRegistryEntry[] {
  const raw = readJson<{ packages: LobsterRegistryEntry[] }>(registryPath);
  return raw.packages;
}

export function loadLobsterRoleCard(entry: LobsterRegistryEntry): LobsterRoleCard {
  return readJson<LobsterRoleCard>(path.join(repoRoot, entry.path, 'role-card.json'));
}

export function loadLobsterSampleArtifact(
  entry: LobsterRegistryEntry,
): Record<string, unknown> | null {
  const filePath = path.join(repoRoot, entry.path, 'evals', 'sample-output.json');

  if (!existsSync(filePath)) {
    return null;
  }

  return readJson<Record<string, unknown>>(filePath);
}

export function resolvePackageAbsolutePath(entry: LobsterRegistryEntry): string {
  return path.join(repoRoot, entry.path);
}
