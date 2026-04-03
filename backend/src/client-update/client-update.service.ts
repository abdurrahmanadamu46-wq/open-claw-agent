import { Injectable } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { createHash, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  ClientReleaseRecord,
  ClientReleaseRollout,
  ClientUpdateChannel,
  ClientUpdateCheckResult,
} from './client-update.types';

@Injectable()
export class ClientUpdateService {
  private readonly signatureRequired = this.isTruthy(process.env.CLIENT_UPDATE_REQUIRE_SIGNATURE);
  private readonly defaultSignatureKeyId = String(process.env.CLIENT_UPDATE_SIGNATURE_DEFAULT_KEY_ID || 'default').trim();
  private readonly signatureKeys = this.loadSignatureKeys();

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private releaseKey(platform: string, channel: ClientUpdateChannel): string {
    return `client:update:${platform}:${channel}`;
  }

  private isTruthy(raw?: string): boolean {
    return ['1', 'true', 'yes', 'on'].includes(String(raw ?? '').trim().toLowerCase());
  }

  private readTextIfPathConfigured(pathEnv: string): string {
    const filePath = String(pathEnv || '').trim();
    if (!filePath) return '';
    try {
      return readFileSync(filePath, 'utf8').trim();
    } catch {
      return '';
    }
  }

  private parseKeyMap(raw: string): Map<string, string> {
    const map = new Map<string, string>();
    if (!raw.trim()) return map;
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      for (const [keyId, key] of Object.entries(parsed)) {
        const normalizedKeyId = String(keyId || '').trim();
        const normalizedKey = String(key || '').trim();
        if (!normalizedKeyId || !normalizedKey) continue;
        map.set(normalizedKeyId, normalizedKey);
      }
    } catch {
      return map;
    }
    return map;
  }

  private loadSignatureKeys(): Map<string, string> {
    const merged = new Map<string, string>();

    const fromInlineMap = this.parseKeyMap(String(process.env.CLIENT_UPDATE_SIGNATURE_KEYS_JSON || ''));
    for (const [k, v] of fromInlineMap.entries()) merged.set(k, v);

    const fromFileMap = this.parseKeyMap(
      this.readTextIfPathConfigured(String(process.env.CLIENT_UPDATE_SIGNATURE_KEYS_PATH || '')),
    );
    for (const [k, v] of fromFileMap.entries()) merged.set(k, v);

    const legacyInline = String(process.env.CLIENT_UPDATE_SIGNATURE_PUBLIC_KEY || '').trim();
    if (legacyInline) {
      merged.set(this.defaultSignatureKeyId, legacyInline);
    }
    const legacyPathKey = this.readTextIfPathConfigured(
      String(process.env.CLIENT_UPDATE_SIGNATURE_PUBLIC_KEY_PATH || ''),
    );
    if (legacyPathKey) {
      merged.set(this.defaultSignatureKeyId, legacyPathKey);
    }

    return merged;
  }

  private isValidSemver(version: string): boolean {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
  }

  private isValidSha256(raw: string): boolean {
    return /^[0-9a-f]{64}$/i.test(raw.trim());
  }

  private toBase64Buffer(raw: string): Buffer | null {
    try {
      const normalized = raw.trim();
      const buffer = Buffer.from(normalized, 'base64');
      if (!buffer.length) return null;
      const normalizedInput = normalized.replace(/=+$/g, '');
      const normalizedBuffer = buffer.toString('base64').replace(/=+$/g, '');
      if (normalizedInput !== normalizedBuffer) return null;
      return buffer;
    } catch {
      return null;
    }
  }

  private buildSignaturePayload(input: {
    platform: string;
    channel: ClientUpdateChannel;
    version: string;
    downloadUrl: string;
    sha256: string;
    minRequiredVersion?: string;
    signatureKeyId?: string;
  }): string {
    return [
      `platform=${input.platform}`,
      `channel=${input.channel}`,
      `version=${input.version}`,
      `downloadUrl=${input.downloadUrl}`,
      `sha256=${input.sha256.toLowerCase()}`,
      `minRequiredVersion=${input.minRequiredVersion?.trim() || ''}`,
      `signatureKeyId=${input.signatureKeyId?.trim() || ''}`,
    ].join('\n');
  }

  private verifyReleaseSignature(input: {
    platform: string;
    channel: ClientUpdateChannel;
    version: string;
    downloadUrl: string;
    sha256: string;
    minRequiredVersion?: string;
    signature: string;
    signatureKeyId: string;
  }): boolean {
    const publicKey = this.signatureKeys.get(input.signatureKeyId);
    if (!publicKey) return false;
    const signature = this.toBase64Buffer(input.signature);
    if (!signature) return false;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(
      this.buildSignaturePayload({
        platform: input.platform,
        channel: input.channel,
        version: input.version,
        downloadUrl: input.downloadUrl,
        sha256: input.sha256,
        minRequiredVersion: input.minRequiredVersion,
        signatureKeyId: input.signatureKeyId,
      }),
      'utf8',
    );
    verifier.end();
    return verifier.verify(publicKey, signature);
  }

  private normalizeRollout(rollout?: ClientReleaseRollout): ClientReleaseRollout | undefined {
    if (!rollout) return undefined;

    const allowlist = Array.isArray(rollout.tenantsAllowlist)
      ? rollout.tenantsAllowlist.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const denylist = Array.isArray(rollout.tenantsDenylist)
      ? rollout.tenantsDenylist.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const hasPercent = typeof rollout.percent === 'number' && Number.isFinite(rollout.percent);
    const percent = hasPercent ? Math.max(0, Math.min(100, Math.floor(rollout.percent ?? 100))) : undefined;
    const salt = rollout.salt?.trim() || undefined;

    if (!allowlist.length && !denylist.length && typeof percent === 'undefined' && !salt) {
      return undefined;
    }

    return {
      ...(typeof percent === 'number' ? { percent } : {}),
      ...(allowlist.length ? { tenantsAllowlist: allowlist } : {}),
      ...(denylist.length ? { tenantsDenylist: denylist } : {}),
      ...(salt ? { salt } : {}),
    };
  }

  private rolloutBucket(input: {
    tenantId: string;
    platform: string;
    channel: string;
    version: string;
    salt?: string;
  }): number {
    const seed = `${input.tenantId}|${input.platform}|${input.channel}|${input.version}|${input.salt ?? ''}`;
    const hash = createHash('sha256').update(seed, 'utf8').digest('hex');
    return Number.parseInt(hash.slice(0, 8), 16) % 100;
  }

  private isTenantEligibleByRollout(input: {
    release: ClientReleaseRecord;
    tenantId?: string;
  }): boolean {
    const rollout = input.release.rollout;
    if (!rollout) return true;

    const tenantId = input.tenantId?.trim();
    const denylist = rollout.tenantsDenylist ?? [];
    const allowlist = rollout.tenantsAllowlist ?? [];

    if (tenantId && denylist.includes(tenantId)) return false;
    if (!tenantId && allowlist.length > 0) return false;
    if (allowlist.length > 0) return tenantId ? allowlist.includes(tenantId) : false;

    const percent = typeof rollout.percent === 'number' ? rollout.percent : 100;
    if (percent <= 0) return false;
    if (percent >= 100) return true;
    if (!tenantId) return false;

    return (
      this.rolloutBucket({
        tenantId,
        platform: input.release.platform,
        channel: input.release.channel,
        version: input.release.version,
        salt: rollout.salt,
      }) < percent
    );
  }

  private compareVersion(a: string, b: string): number {
    const normalize = (v: string): [number, number, number, string] => {
      const [core, pre = ''] = v.split('-', 2);
      const [major = '0', minor = '0', patch = '0'] = core.split('.');
      return [
        Number.parseInt(major, 10) || 0,
        Number.parseInt(minor, 10) || 0,
        Number.parseInt(patch, 10) || 0,
        pre,
      ];
    };
    const av = normalize(a);
    const bv = normalize(b);
    if (av[0] !== bv[0]) return av[0] > bv[0] ? 1 : -1;
    if (av[1] !== bv[1]) return av[1] > bv[1] ? 1 : -1;
    if (av[2] !== bv[2]) return av[2] > bv[2] ? 1 : -1;
    if (!av[3] && bv[3]) return 1;
    if (av[3] && !bv[3]) return -1;
    if (av[3] === bv[3]) return 0;
    return av[3] > bv[3] ? 1 : -1;
  }

  async publishRelease(input: {
    platform: string;
    channel: ClientUpdateChannel;
    version: string;
    downloadUrl: string;
    notes?: string;
    sha256?: string;
    signature?: string;
    signatureAlgorithm?: 'RSA-SHA256';
    signatureKeyId?: string;
    minRequiredVersion?: string;
    rollout?: ClientReleaseRollout;
    publishedBy?: string;
  }): Promise<ClientReleaseRecord> {
    const platform = input.platform.trim();
    const channel = input.channel;
    const version = input.version.trim();
    const downloadUrl = input.downloadUrl.trim();
    const sha256 = String(input.sha256 ?? '').trim().toLowerCase();
    const rollout = this.normalizeRollout(input.rollout);

    if (!platform) throw new Error('platform is required');
    if (!this.isValidSemver(version)) throw new Error('version must follow semver (x.y.z)');
    if (!/^https?:\/\/.+/i.test(downloadUrl)) throw new Error('downloadUrl must be a valid URL');
    if (!sha256) throw new Error('sha256 is required');
    if (!this.isValidSha256(sha256)) throw new Error('sha256 must be a valid 64-character hex digest');
    if (input.minRequiredVersion?.trim() && !this.isValidSemver(input.minRequiredVersion.trim())) {
      throw new Error('minRequiredVersion must follow semver (x.y.z)');
    }
    if (typeof input.rollout?.percent === 'number' && !Number.isFinite(input.rollout.percent)) {
      throw new Error('rollout.percent must be a number');
    }

    const signature = input.signature?.trim();
    const signatureAlgorithm = input.signatureAlgorithm ?? 'RSA-SHA256';
    const signatureKeyId = input.signatureKeyId?.trim() || this.defaultSignatureKeyId;

    if (signatureAlgorithm !== 'RSA-SHA256') {
      throw new Error('unsupported signatureAlgorithm, expected RSA-SHA256');
    }

    if (this.signatureRequired && !signature) {
      throw new Error('signature is required by policy');
    }

    if ((signature || this.signatureRequired) && !this.signatureKeys.has(signatureKeyId)) {
      throw new Error(`signature verification public key is not configured for keyId=${signatureKeyId}`);
    }

    if (signature) {
      const ok = this.verifyReleaseSignature({
        platform,
        channel,
        version,
        downloadUrl,
        sha256,
        minRequiredVersion: input.minRequiredVersion?.trim(),
        signature,
        signatureKeyId,
      });
      if (!ok) {
        throw new Error('signature verification failed');
      }
    }

    const record: ClientReleaseRecord = {
      platform,
      channel,
      version,
      downloadUrl,
      sha256,
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      ...(signature ? { signature } : {}),
      ...(signature ? { signatureAlgorithm } : {}),
      ...(signature ? { signatureKeyId } : {}),
      ...(input.minRequiredVersion?.trim() ? { minRequiredVersion: input.minRequiredVersion.trim() } : {}),
      ...(rollout ? { rollout } : {}),
      publishedAt: new Date().toISOString(),
      ...(input.publishedBy?.trim() ? { publishedBy: input.publishedBy.trim() } : {}),
    };

    await this.redis.set(this.releaseKey(platform, channel), JSON.stringify(record));
    return record;
  }

  async getLatest(
    platformInput: string,
    channelInput: string,
    currentVersion?: string,
    tenantId?: string,
  ): Promise<ClientUpdateCheckResult> {
    const platform = platformInput.trim();
    const channel = (channelInput.trim().toLowerCase() || 'stable') as ClientUpdateChannel;
    const normalizedTenantId = tenantId?.trim();
    const raw = await this.redis.get(this.releaseKey(platform, channel));
    if (!raw) {
      return {
        platform,
        channel,
        ...(currentVersion?.trim() ? { currentVersion: currentVersion.trim() } : {}),
        ...(normalizedTenantId ? { tenantId: normalizedTenantId } : {}),
        hasUpdate: false,
      };
    }

    const release = JSON.parse(raw) as ClientReleaseRecord;
    const tenantEligible = this.isTenantEligibleByRollout({
      release,
      tenantId: normalizedTenantId,
    });
    if (!tenantEligible) {
      return {
        platform,
        channel,
        ...(currentVersion?.trim() ? { currentVersion: currentVersion.trim() } : {}),
        ...(normalizedTenantId ? { tenantId: normalizedTenantId } : {}),
        hasUpdate: false,
      };
    }

    const normalizedCurrent = currentVersion?.trim();
    if (!normalizedCurrent || !this.isValidSemver(normalizedCurrent)) {
      return {
        platform,
        channel,
        ...(normalizedCurrent ? { currentVersion: normalizedCurrent } : {}),
        ...(normalizedTenantId ? { tenantId: normalizedTenantId } : {}),
        hasUpdate: true,
        release,
      };
    }

    return {
      platform,
      channel,
      currentVersion: normalizedCurrent,
      ...(normalizedTenantId ? { tenantId: normalizedTenantId } : {}),
      hasUpdate: this.compareVersion(release.version, normalizedCurrent) > 0,
      release,
    };
  }
}
