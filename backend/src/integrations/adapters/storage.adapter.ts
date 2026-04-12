/**
 * 自带对象存储适配器 — 预签名 URL 直传，零存储成本
 * 前端/Agent 通过 Presigned URL 直接把视频传到客户自己的 OSS/S3，彻底绕过自有服务器，不承担文件流转（Stream）
 */

import type { TenantIntegrationsStorage } from '../tenant-integrations.types';

export interface PresignedUploadResult {
  /** 预签名上传 URL，客户端 PUT 到此 URL 即直传至客户桶 */
  uploadUrl: string;
  /** 建议的 HTTP 方法 */
  method: 'PUT';
  /** 可选：上传后可访问的最终对象 URL（供后续引用） */
  objectUrl?: string;
  /** 可选：建议的请求头，如 Content-Type */
  headers?: Record<string, string>;
}

/**
 * 存储适配器接口：根据租户配置生成预签名 URL，由调用方直传，服务器不落盘、不转流
 */
export interface StorageAdapter {
  readonly name: string;

  /**
   * 生成上传预签名 URL
   * 调用方（前端/Agent）拿到 URL 后直接 PUT 文件到 OSS/S3，流量与存储均发生在客户自己的桶内
   * @param config 租户的 storage 配置（来自 TenantIntegrations.storage）
   * @param fileName 对象键（如 videos/tenant-1/2024/xxx.mp4）
   * @param options 可选：Content-Type、过期秒数等
   */
  getUploadPresignedUrl(
    config: TenantIntegrationsStorage,
    fileName: string,
    options?: { contentType?: string; expiresInSeconds?: number },
  ): Promise<PresignedUploadResult>;
}

/**
 * 空壳实现：未接入真实 OSS/S3 时返回占位 URL，生产替换为阿里云/ AWS SDK 生成预签名
 */
export class StorageAdapterStub implements StorageAdapter {
  readonly name = 'storage-adapter-stub';

  async getUploadPresignedUrl(
    config: TenantIntegrationsStorage,
    fileName: string,
    _options?: { contentType?: string; expiresInSeconds?: number },
  ): Promise<PresignedUploadResult> {
    // 生产实现：使用 @aws-sdk/s3-request-presigner 或 ali-oss.getSignatureUrl 生成真实 URL
    const placeholder = `https://${config.bucketName}.${config.region}.example.com/upload?key=${encodeURIComponent(fileName)}&stub=1`;
    return {
      uploadUrl: placeholder,
      method: 'PUT',
      objectUrl: placeholder.replace('/upload?', '/'),
      headers: { 'Content-Type': 'video/mp4' },
    };
  }
}
