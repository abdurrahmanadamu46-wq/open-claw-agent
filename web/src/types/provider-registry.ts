export interface ProviderConfig {
  id: string;
  name: string;
  type: 'openai_compatible' | 'anthropic' | 'gemini' | 'local';
  route: 'local' | 'cloud';
  base_url: string;
  api_key_masked: string;
  api_key_configured: boolean;
  models: string[];
  default_model: string;
  priority: number;
  weight: number;
  enabled: boolean;
  status: 'healthy' | 'degraded' | 'offline';
  created_at: string;
  updated_at: string;
  note?: string;
  last_error?: string | null;
  success_rate_1h?: number;
  total_calls_24h?: number;
  avg_latency_ms?: number;
}

export interface ProviderHealth {
  id: string;
  status: 'healthy' | 'degraded' | 'offline';
  latency_ms: number;
  success_rate_1h: number;
  total_calls_24h: number;
  last_checked?: string;
}

export interface ProviderMetrics {
  id: string;
  status: 'healthy' | 'degraded' | 'offline';
  calls_by_hour: Array<{ hour: string; count: number; success: number }>;
  avg_latency_ms: number;
  success_rate_1h: number;
  total_calls_24h: number;
  error_rate: number;
}
