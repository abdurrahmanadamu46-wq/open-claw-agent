import type { TenantIntegrationsStorage } from '../tenant-integrations.types';
export interface PresignedUploadResult {
    uploadUrl: string;
    method: 'PUT';
    objectUrl?: string;
    headers?: Record<string, string>;
}
export interface StorageAdapter {
    readonly name: string;
    getUploadPresignedUrl(config: TenantIntegrationsStorage, fileName: string, options?: {
        contentType?: string;
        expiresInSeconds?: number;
    }): Promise<PresignedUploadResult>;
}
export declare class StorageAdapterStub implements StorageAdapter {
    readonly name = "storage-adapter-stub";
    getUploadPresignedUrl(config: TenantIntegrationsStorage, fileName: string, _options?: {
        contentType?: string;
        expiresInSeconds?: number;
    }): Promise<PresignedUploadResult>;
}
