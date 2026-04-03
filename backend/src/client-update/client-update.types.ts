export type ClientUpdateChannel = 'stable' | 'beta' | 'canary';

export interface ClientReleaseRollout {
  percent?: number;
  tenantsAllowlist?: string[];
  tenantsDenylist?: string[];
  salt?: string;
}

export interface ClientReleaseRecord {
  platform: string;
  channel: ClientUpdateChannel;
  version: string;
  downloadUrl: string;
  notes?: string;
  sha256: string;
  signature?: string;
  signatureKeyId?: string;
  signatureAlgorithm?: 'RSA-SHA256';
  minRequiredVersion?: string;
  rollout?: ClientReleaseRollout;
  publishedAt: string;
  publishedBy?: string;
}

export interface ClientUpdateCheckResult {
  platform: string;
  channel: ClientUpdateChannel;
  currentVersion?: string;
  tenantId?: string;
  hasUpdate: boolean;
  release?: ClientReleaseRecord;
}
