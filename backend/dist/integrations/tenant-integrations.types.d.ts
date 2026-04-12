export interface TenantIntegrationsLlm {
    provider: 'deepseek' | 'openai' | 'custom';
    apiKey: string;
    baseUrl?: string;
    model: string;
}
export interface TenantIntegrationsTts {
    provider: 'elevenlabs' | 'azure' | 'aliyun';
    apiKey: string;
    voiceId: string;
}
export interface TenantIntegrationsProxy {
    enabled: boolean;
    proxyList: string[];
}
export interface TenantIntegrationsWebhook {
    enabled: boolean;
    leadCaptureUrl: string;
}
export interface TenantIntegrationsStorage {
    provider: 'aliyun_oss' | 'aws_s3';
    bucketName: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
}
export interface TenantIntegrationsCloudPhone {
    enabled: boolean;
    devices: string[];
}
export interface TenantIntegrationsAiCustomerService {
    provider: 'coze' | 'fastgpt' | string;
    apiToken: string;
    botId: string;
}
export interface TenantCustomTools {
    mcpServers: Array<{
        name: string;
        url: string;
        token?: string;
    }>;
    customApis: Array<{
        name: string;
        description: string;
        endpoint: string;
        method: 'GET' | 'POST';
        schema: object;
    }>;
}
export interface TenantIntegrations {
    llm?: TenantIntegrationsLlm;
    tts?: TenantIntegrationsTts;
    proxy?: TenantIntegrationsProxy;
    webhook?: TenantIntegrationsWebhook;
    storage?: TenantIntegrationsStorage;
    cloud_phone?: TenantIntegrationsCloudPhone;
    ai_customer_service?: TenantIntegrationsAiCustomerService;
    custom_tools?: TenantCustomTools;
}
