export type IntegrationCapability =
  | 'llm.chat'
  | 'llm.reasoning'
  | 'audio.tts'
  | 'audio.asr'
  | 'voice.call'
  | 'webhook.lead_capture'
  | 'storage.object'
  | 'proxy.routing'
  | 'crm.push'
  | 'workflow.automation'
  | 'mcp.tools';

export type AdapterHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'down';
export type AdapterAuthType = 'none' | 'api_key' | 'bearer' | 'basic';

export interface PluginAdapterHealth {
  status: AdapterHealthStatus;
  latencyMs?: number;
  lastCheckedAt?: string;
  message?: string;
}

export interface PluginAdapterConfig {
  id: string;
  provider: string;
  displayName: string;
  enabled: boolean;
  capabilities: IntegrationCapability[];
  authType?: AdapterAuthType;
  baseUrl?: string;
  webhookUrl?: string;
  apiKey?: string;
  model?: string;
  headers?: Record<string, string>;
  meta?: Record<string, unknown>;
  health?: PluginAdapterHealth;
}

export type CapabilityRouteMode = 'auto' | 'force' | 'fallback';

export interface CapabilityRoutePolicy {
  mode: CapabilityRouteMode;
  primaryAdapterId?: string;
  fallbackAdapterIds?: string[];
}

export type CapabilityRoutingMap = Partial<Record<IntegrationCapability, CapabilityRoutePolicy>>;

export interface TenantPluginHub {
  adapters: PluginAdapterConfig[];
  routing: CapabilityRoutingMap;
  updatedAt?: string;
}

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

export type GroupChannelProvider = 'mock' | 'feishu' | 'wechat_work' | 'wechat' | 'dingtalk' | 'custom';
export type GroupRespondMode = 'always' | 'intent' | 'mention_only';
export type GroupCollabObjectType = 'message' | 'report' | 'approval' | 'confirmation' | 'reminder' | 'receipt';
export type GroupCollabAdapterMode = 'mock' | 'live';
export type GroupCollabKnowledgeCaptureMode = 'none' | 'approved_excerpt';

export interface GroupCollabAdapterConfig {
  id: string;
  label: string;
  provider: GroupChannelProvider;
  enabled: boolean;
  mode: GroupCollabAdapterMode;
  capabilities: GroupCollabObjectType[];
  webhookUrl?: string;
  secret?: string;
  defaultChatId?: string;
  defaultTargetName?: string;
  notes?: string;
}

export interface TenantGroupCollabConfig {
  enabled: boolean;
  provider: GroupChannelProvider;
  respondMode: GroupRespondMode;
  approvalNotifications: boolean;
  placeholderEnabled: boolean;
  placeholderThresholdMs: number;
  knowledgeCaptureMode: GroupCollabKnowledgeCaptureMode;
  knowledgeTargetLayer: 'tenant_private';
  allowPlatformKnowledgeBackflow: false;
  mockDataEnabled: boolean;
  defaultAdapterId: string;
  adapters: GroupCollabAdapterConfig[];
}

export interface TenantIntegrationsVoiceAgent {
  provider: 'vapi' | 'retell';
  apiKey: string;
  sipTrunk?: string;
}

export interface TenantCustomTools {
  mcpServers: Array<{ name: string; url: string; token?: string }>;
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
  group_collab?: TenantGroupCollabConfig;
  voice_agent?: TenantIntegrationsVoiceAgent;
  custom_tools?: TenantCustomTools;
  plugin_hub?: TenantPluginHub;
}
