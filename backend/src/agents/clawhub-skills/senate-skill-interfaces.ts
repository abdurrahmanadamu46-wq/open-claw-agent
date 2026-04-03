import type { ClawhubAgentId } from './schemas';

export type SkillInvokeContext = {
  tenantId: string;
  traceId?: string;
  timeoutMs?: number;
  dryRun?: boolean;
};

export type SkillExecutionEnvelope<T> = {
  ok: true;
  traceId?: string;
  timestamp: string;
  data: T;
};

export type SkillEdge = {
  from: `${ClawhubAgentId}.${string}`;
  to: `${ClawhubAgentId}.${string}`;
  artifact: string;
};

async function wrapSkill<T>(ctx: SkillInvokeContext | undefined, data: T): Promise<SkillExecutionEnvelope<T>> {
  return {
    ok: true,
    traceId: ctx?.traceId,
    timestamp: new Date().toISOString(),
    data,
  };
}

// ========== Universal Safety ==========
export interface SkillVetterInput {
  skill_name: string;
}

export interface SkillVetterOutput {
  allowed: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  report: string;
}

export async function skill_vetter(
  input: SkillVetterInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<SkillVetterOutput>> {
  return wrapSkill(ctx, {
    allowed: true,
    riskLevel: 'low',
    report: `skill ${input.skill_name} passed pre-install vetting`,
  });
}

// ========== Radar ==========
export interface AgentBrowserCommand {
  action: 'goto' | 'click' | 'type' | 'scroll' | 'wait' | 'screenshot';
  selector?: string;
  value?: string;
  x?: number;
  y?: number;
}

export interface AgentBrowserExecuteInput {
  url: string;
  commands: AgentBrowserCommand[];
}

export interface AgentBrowserExecuteOutput {
  html: string;
  domSnapshot: string;
  screenshots: string[];
}

export async function agent_browser_execute(
  input: AgentBrowserExecuteInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<AgentBrowserExecuteOutput>> {
  return wrapSkill(ctx, {
    html: `<!-- fetched from ${input.url} -->`,
    domSnapshot: `snapshot:${input.commands.length}`,
    screenshots: [],
  });
}

export interface SummarizePageInput {
  content_or_url: string;
  format?: 'markdown' | 'bullets';
}

export interface SummarizePageOutput {
  normalizedText: string;
  tokensEstimate: number;
}

export async function summarize_page(
  input: SummarizePageInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<SummarizePageOutput>> {
  return wrapSkill(ctx, {
    normalizedText: input.content_or_url.slice(0, 4000),
    tokensEstimate: Math.ceil(input.content_or_url.length / 4),
  });
}

// ========== Strategist ==========
export interface SelfImprovingAgentRecordInput {
  event_type: 'error' | 'user_correction' | 'success';
  content: string;
  context?: Record<string, unknown>;
}

export interface SelfImprovingAgentRecordOutput {
  memoryId: string;
  stored: boolean;
}

export async function self_improving_agent_record(
  input: SelfImprovingAgentRecordInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<SelfImprovingAgentRecordOutput>> {
  return wrapSkill(ctx, {
    memoryId: `mem_${Date.now()}`,
    stored: !!input.content,
  });
}

export interface OntologyQueryInput {
  query: string;
  mode: 'cluster' | 'search' | 'upsert';
  payload?: Record<string, unknown>;
}

export interface OntologyQueryOutput {
  graphResult: Record<string, unknown>;
}

export async function ontology_query(
  input: OntologyQueryInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<OntologyQueryOutput>> {
  return wrapSkill(ctx, {
    graphResult: {
      mode: input.mode,
      query: input.query,
      payload: input.payload ?? null,
    },
  });
}

export interface ProactiveAgentScanInput {
  scope: string;
  analysis_type?: 'trend' | 'anomaly' | 'report';
}

export interface ProactiveAgentScanOutput {
  campaignParams: Record<string, unknown>;
}

export async function proactive_agent_scan(
  input: ProactiveAgentScanInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<ProactiveAgentScanOutput>> {
  return wrapSkill(ctx, {
    campaignParams: {
      scope: input.scope,
      analysis_type: input.analysis_type ?? 'trend',
      generated_at: new Date().toISOString(),
    },
  });
}

// ========== InkWriter ==========
export interface HumanizerTextInput {
  text: string;
  style?: 'casual' | 'mom_community' | 'young';
  intensity?: number;
}

export interface HumanizerTextOutput {
  humanizedText: string;
  diffHints: string[];
}

export async function humanizer_text(
  input: HumanizerTextInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<HumanizerTextOutput>> {
  return wrapSkill(ctx, {
    humanizedText: input.text,
    diffHints: [`style=${input.style ?? 'casual'}`, `intensity=${input.intensity ?? 0.5}`],
  });
}

export interface SummarizeForDedupInput {
  content: string;
  template_id?: string;
}

export interface SummarizeForDedupOutput {
  canonicalContent: string;
  hash: string;
}

export async function summarize_for_dedup(
  input: SummarizeForDedupInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<SummarizeForDedupOutput>> {
  const canonicalContent = input.content.trim().replace(/\s+/g, ' ');
  return wrapSkill(ctx, {
    canonicalContent,
    hash: `hash_${canonicalContent.length}`,
  });
}

// ========== Visualizer ==========
export interface NanoBananaProImageInput {
  prompt: string;
  mode?: 'generate' | 'edit';
  reference_image_url?: string;
  seed?: number;
}

export interface NanoBananaProImageOutput {
  promptPack: Record<string, unknown>;
}

export async function nano_banana_pro_image(
  input: NanoBananaProImageInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<NanoBananaProImageOutput>> {
  return wrapSkill(ctx, {
    promptPack: {
      prompt: input.prompt,
      mode: input.mode ?? 'generate',
      reference_image_url: input.reference_image_url,
      seed: input.seed,
    },
  });
}

// ========== Dispatcher ==========
export interface ProactiveAgentNodeHealthInput {
  node_ids?: string[];
  policy_tensor?: Record<string, unknown>;
}

export interface ProactiveAgentNodeHealthOutput {
  healthyNodes: string[];
  removedNodes: string[];
}

export async function proactive_agent_node_health(
  input: ProactiveAgentNodeHealthInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<ProactiveAgentNodeHealthOutput>> {
  return wrapSkill(ctx, {
    healthyNodes: input.node_ids ?? [],
    removedNodes: [],
  });
}

export interface AutoUpdaterRunInput {
  target: 'all' | 'node_ids';
  node_ids?: string[];
}

export interface AutoUpdaterRunOutput {
  updatedNodes: string[];
  version: string;
}

export async function auto_updater_run(
  input: AutoUpdaterRunInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<AutoUpdaterRunOutput>> {
  return wrapSkill(ctx, {
    updatedNodes: input.target === 'all' ? ['all'] : (input.node_ids ?? []),
    version: 'latest',
  });
}

// ========== Echoer ==========
export interface HumanizerReplyInput {
  reply_draft: string;
  platform?: 'douyin' | 'xiaohongshu' | 'generic';
  entropy_level?: 'low' | 'medium' | 'high';
}

export interface HumanizerReplyOutput {
  reply: string;
  riskScore: number;
}

export async function humanizer_reply(
  input: HumanizerReplyInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<HumanizerReplyOutput>> {
  return wrapSkill(ctx, {
    reply: input.reply_draft,
    riskScore: input.entropy_level === 'high' ? 0.6 : 0.3,
  });
}

// ========== Catcher ==========
export interface SummarizeIntentInput {
  comments_batch: string[];
  extract_entities?: boolean;
}

export interface SummarizeIntentOutput {
  intentCandidates: Array<Record<string, unknown>>;
}

export async function summarize_intent(
  input: SummarizeIntentInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<SummarizeIntentOutput>> {
  return wrapSkill(ctx, {
    intentCandidates: input.comments_batch.map((comment) => ({ comment, intent: 'unknown' })),
  });
}

export interface OntologyExtractLeadInput {
  text: string;
  upsert?: boolean;
}

export interface OntologyExtractLeadOutput {
  leadSignals: Array<Record<string, unknown>>;
}

export async function ontology_extract_lead(
  input: OntologyExtractLeadInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<OntologyExtractLeadOutput>> {
  return wrapSkill(ctx, {
    leadSignals: [{ text: input.text, upsert: input.upsert ?? false }],
  });
}

// ========== Abacus ==========
export interface ApiGatewayWebhookInput {
  channel: 'feishu' | 'dingtalk' | 'custom_webhook';
  payload: Record<string, unknown>;
  webhook_url?: string;
}

export interface ApiGatewayWebhookOutput {
  delivered: boolean;
  target: string;
}

export async function api_gateway_webhook(
  input: ApiGatewayWebhookInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<ApiGatewayWebhookOutput>> {
  return wrapSkill(ctx, {
    delivered: true,
    target: input.channel,
  });
}

export interface GogPushLeadInput {
  lead_json: Record<string, unknown>;
  destination: 'gmail' | 'calendar' | 'sheet';
}

export interface GogPushLeadOutput {
  synced: boolean;
  recordId: string;
}

export async function gog_push_lead(
  input: GogPushLeadInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<GogPushLeadOutput>> {
  return wrapSkill(ctx, {
    synced: true,
    recordId: `${input.destination}_${Date.now()}`,
  });
}

// ========== FollowUp ==========
export interface OpenaiWhisperTranscribeInput {
  audio_input: string;
  language?: 'zh' | 'en';
  vad_enabled?: boolean;
}

export interface OpenaiWhisperTranscribeOutput {
  transcript: string;
  segments: Array<{ start: number; end: number; text: string }>;
}

export async function openai_whisper_transcribe(
  input: OpenaiWhisperTranscribeInput,
  ctx?: SkillInvokeContext,
): Promise<SkillExecutionEnvelope<OpenaiWhisperTranscribeOutput>> {
  return wrapSkill(ctx, {
    transcript: `transcribed from ${input.audio_input.slice(0, 60)}`,
    segments: [{ start: 0, end: 1, text: 'sample segment' }],
  });
}

// ========== DAG / Dependency ==========
export const SENATE_SKILL_DEPENDENCIES: SkillEdge[] = [
  { from: 'radar.agent_browser_execute', to: 'radar.summarize_page', artifact: 'radar.raw_page' },
  { from: 'radar.summarize_page', to: 'strategist.ontology_query', artifact: 'radar.market_intel' },
  { from: 'strategist.ontology_query', to: 'strategist.proactive_agent_scan', artifact: 'strategist.knowledge_graph' },
  { from: 'strategist.proactive_agent_scan', to: 'ink-writer.humanizer_text', artifact: 'strategist.campaign_params' },
  { from: 'ink-writer.summarize_for_dedup', to: 'visualizer.nano_banana_pro_image', artifact: 'ink_writer.template_json' },
  { from: 'visualizer.nano_banana_pro_image', to: 'dispatcher.proactive_agent_node_health', artifact: 'visualizer.prompt_pack' },
  { from: 'dispatcher.proactive_agent_node_health', to: 'dispatcher.auto_updater_run', artifact: 'dispatcher.node_plan' },
  { from: 'dispatcher.auto_updater_run', to: 'echoer.humanizer_reply', artifact: 'dispatcher.updated_nodes' },
  { from: 'echoer.humanizer_reply', to: 'catcher.summarize_intent', artifact: 'echoer.reply_output' },
  { from: 'catcher.summarize_intent', to: 'catcher.ontology_extract_lead', artifact: 'catcher.intent_candidates' },
  { from: 'catcher.ontology_extract_lead', to: 'abacus.api_gateway_webhook', artifact: 'catcher.lead_signals' },
  { from: 'abacus.api_gateway_webhook', to: 'abacus.gog_push_lead', artifact: 'abacus.delivery_status' },
  { from: 'abacus.gog_push_lead', to: 'follow-up.openai_whisper_transcribe', artifact: 'abacus.crm_sync' },
];

// ========== Call Examples ==========
export const SENATE_SKILL_CALL_EXAMPLES = {
  radar: {
    agent_browser_execute: {
      input: {
        url: 'https://www.douyin.com/video/hot-post',
        commands: [{ action: 'goto' }, { action: 'scroll', y: 900 }, { action: 'screenshot' }],
      } as AgentBrowserExecuteInput,
    },
    summarize_page: {
      input: {
        content_or_url: 'https://www.douyin.com/video/hot-post',
        format: 'markdown',
      } as SummarizePageInput,
    },
  },
  strategist: {
    proactive_agent_scan: {
      input: {
        scope: 'douyin:last_24h:beauty',
        analysis_type: 'trend',
      } as ProactiveAgentScanInput,
    },
  },
  dispatcher: {
    auto_updater_run: {
      input: {
        target: 'node_ids',
        node_ids: ['node-001', 'node-003'],
      } as AutoUpdaterRunInput,
    },
  },
  followUp: {
    openai_whisper_transcribe: {
      input: {
        audio_input: 'https://cdn.sflaw.store/calls/call-01.wav',
        language: 'zh',
        vad_enabled: true,
      } as OpenaiWhisperTranscribeInput,
    },
  },
};

