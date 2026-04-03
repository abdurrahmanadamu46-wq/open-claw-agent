import type { TenantIntegrationsStorage } from '../tenant-integrations.types';

export interface PresignedUploadResult {
  uploadUrl: string;
  method: 'PUT';
  objectUrl?: string;
  headers?: Record<string, string>;
}

export interface StorageAdapter {
  readonly name: string;
  getUploadPresignedUrl(
    config: TenantIntegrationsStorage,
    fileName: string,
    options?: { contentType?: string; expiresInSeconds?: number },
  ): Promise<PresignedUploadResult>;
}

/**
 * Guard adapter used by default backend wiring.
 *
 * We intentionally do NOT return placeholder URLs.
 * If tenants require object storage direct upload, a real signer implementation
 * must be enabled via STORAGE_SIGNER_ENDPOINT.
 */
export class StorageAdapterStub implements StorageAdapter {
  readonly name = 'storage-adapter-guard';

  async getUploadPresignedUrl(
    config: TenantIntegrationsStorage,
    fileName: string,
    options?: { contentType?: string; expiresInSeconds?: number },
  ): Promise<PresignedUploadResult> {
    const signer = String(process.env.STORAGE_SIGNER_ENDPOINT ?? '').trim();
    if (!signer) {
      throw new Error(
        'Storage presign disabled: set STORAGE_SIGNER_ENDPOINT and deploy a real signer service',
      );
    }

    const url = new URL(signer);
    const payload = {
      provider: config.provider,
      bucketName: config.bucketName,
      region: config.region,
      fileName,
      contentType: options?.contentType ?? 'application/octet-stream',
      expiresInSeconds: options?.expiresInSeconds ?? 900,
    };

    // Delegates signature generation to a real internal signer service.
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signer-Token': String(process.env.STORAGE_SIGNER_TOKEN ?? ''),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`storage signer request failed: status=${response.status}`);
    }

    const data = (await response.json()) as PresignedUploadResult;
    if (!data?.uploadUrl || data?.method !== 'PUT') {
      throw new Error('storage signer returned invalid presign payload');
    }
    return data;
  }
}
