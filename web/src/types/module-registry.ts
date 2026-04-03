export interface ModuleSpec {
  module_id: string;
  name: string;
  description: string;
  inputs: string[];
  outputs: string[];
  available_to: string[];
  avg_tokens: number;
  avg_latency_ms: number;
  tags: string[];
}
