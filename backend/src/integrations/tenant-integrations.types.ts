/**
 * BYOK 插件中心 — 租户第三方集成配置（可存 JSONB 或 Redis）
 */

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
  /** 格式如 http://user:pass@ip:port */
  proxyList: string[];
}

export interface TenantIntegrationsWebhook {
  enabled: boolean;
  /** 抓到线索后推送的地址 */
  leadCaptureUrl: string;
}

/** 自带对象存储（阿里云 OSS / AWS S3），零存储成本、视频直传客户桶 */
export interface TenantIntegrationsStorage {
  provider: 'aliyun_oss' | 'aws_s3';
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/** 云手机 / App 端自动化，ADB 设备列表 */
export interface TenantIntegrationsCloudPhone {
  enabled: boolean;
  /** 如 ['192.168.1.100:5555', 'usb-device-id'] */
  devices: string[];
}

/** 外接知识库客服（Coze / FastGPT 等）自动回复评论 */
export interface TenantIntegrationsAiCustomerService {
  provider: 'coze' | 'fastgpt' | string;
  apiToken: string;
  botId: string;
}

/**
 * 动态工具注册中心 — MCP + 自定义 API，支持无限扩展 AI 能力
 * 对应 TenantConfig.custom_tools 字段（JSONB 或 Redis 内嵌）
 */
export interface TenantCustomTools {
  /** 用户自带的 MCP 服务器地址 */
  mcpServers: Array<{ name: string; url: string; token?: string }>;
  /** 自定义 API（OpenAPI Schema 风格），供 LLM Function Calling 使用 */
  customApis: Array<{
    name: string;
    description: string;
    endpoint: string;
    method: 'GET' | 'POST';
    /** OpenAPI 格式的参数定义 */
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
  /** 动态工具注册：MCP 服务器 + 自定义 API，供 injectUserToolsIntoContext 消费 */
  custom_tools?: TenantCustomTools;
}
