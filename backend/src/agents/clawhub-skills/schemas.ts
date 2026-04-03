/**
 * 龙虾元老院 ClawHub Skill → OpenAPI Function Schema
 * 与 LLMFunctionTool 兼容，供 injectUserToolsIntoContext 或按 Agent 注入使用。
 *
 * 安全：所有技能安装前必须先安装并调用 skill-vetter。
 * npx clawhub@latest install skill-vetter
 * clawhub vet <skill-name>
 */
import type { LLMFunctionTool } from '../../agent-coordinator/agent-coordinator.types';

/** Agent ID 与 custom-lobster-agents 一致 */
export type ClawhubAgentId =
  | 'radar'
  | 'strategist'
  | 'ink-writer'
  | 'visualizer'
  | 'dispatcher'
  | 'echoer'
  | 'catcher'
  | 'abacus'
  | 'follow-up';

// ---------- 通用安全（必须先注册为全局 tool） ----------
export const SKILL_VETTER_TOOL: LLMFunctionTool = {
  type: 'function',
  function: {
    name: 'skill_vetter',
    description:
      '安装任何 ClawHub 技能前必须调用的安全审查器。对 skill_name 做红旗检测与权限审计，通过后才允许安装。',
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: '待审查的 skill 名称，如 agent-browser、summarize',
        },
      },
      required: ['skill_name'],
    },
  },
};

// ---------- 触须虾 radar ----------
const RADAR_TOOLS: LLMFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'agent_browser_execute',
      description:
        '无头浏览器执行：打开 URL 并执行结构化命令（点、填、滚、截图、绕 Cloudflare/极验）。Rust 引擎抗 bot，替代多爬虫 skill。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '目标页面 URL' },
          commands_json: {
            type: 'string',
            description: 'JSON 数组，如 [{"action":"click","selector":".btn"},{"action":"scroll","y":500}]',
          },
        },
        required: ['url', 'commands_json'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_page',
      description:
        '将 HTML/页面/评论清洗为 Markdown（去广告），供大模型消费。替代 DOM_to_Markdown_Parser。',
      parameters: {
        type: 'object',
        properties: {
          content_or_url: {
            type: 'string',
            description: 'HTML 片段或页面 URL',
          },
          format: {
            type: 'string',
            description: '输出格式：markdown | bullets',
            enum: ['markdown', 'bullets'],
          },
        },
        required: ['content_or_url'],
      },
    },
  },
];

// ---------- 脑虫虾 strategist ----------
const STRATEGIST_TOOLS: LLMFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'self_improving_agent_record',
      description:
        '自动记录错误与用户纠正，写入 Qdrant RAG 历史兵法，供 Strategist memory loop 进化。',
      parameters: {
        type: 'object',
        properties: {
          event_type: {
            type: 'string',
            description: 'error | user_correction | success',
            enum: ['error', 'user_correction', 'success'],
          },
          content: { type: 'string', description: '事件内容或纠正说明' },
          context_json: { type: 'string', description: '可选上下文 JSON' },
        },
        required: ['event_type', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ontology_query',
      description:
        '知识图谱结构化记忆：评论聚类、历史打法检索。替代 Trend_Keyword_Cluster + Vector_DB_Search。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索问句或关键词' },
          mode: {
            type: 'string',
            description: 'cluster | search | upsert',
            enum: ['cluster', 'search', 'upsert'],
          },
          payload: { type: 'string', description: 'upsert 时的结构化 JSON' },
        },
        required: ['query', 'mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'proactive_agent_scan',
      description: '主动巡检数据趋势，触发 Pandas 分析或策略建议。',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: '数据范围或数据源 ID' },
          analysis_type: { type: 'string', description: 'trend | anomaly | report' },
        },
        required: ['scope'],
      },
    },
  },
];

// ---------- 吐墨虾 ink-writer ----------
const INKWRITER_TOOLS: LLMFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'humanizer_text',
      description:
        '去 AI 味：注入错别字、口语、宝妈黑话、绝绝子等，生成后必调。替代 Emoji_&_Slang_Injector。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '原始文案' },
          style: {
            type: 'string',
            description: 'casual | mom_community | young',
            enum: ['casual', 'mom_community', 'young'],
          },
          intensity: {
            type: 'number',
            description: '拟人化强度 0-1',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_for_dedup',
      description: '模板结构强控 + 查重前清洗，用于吐墨虾成稿前。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '待清洗/结构化文本' },
          template_id: { type: 'string', description: '可选模板 ID' },
        },
        required: ['content'],
      },
    },
  },
];

// ---------- 幻影虾 visualizer ----------
const VISUALIZER_TOOLS: LLMFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'nano_banana_pro_image',
      description:
        'Gemini 图像生成/编辑 + 一致性种子 + Reference Image，做分镜。替代 Prompt_Translation_Engine + Character_Consistency_Locker。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '画面描述或分镜 prompt' },
          mode: { type: 'string', description: 'generate | edit', enum: ['generate', 'edit'] },
          reference_image_url: { type: 'string', description: '参考图 URL（一致性用）' },
          seed: { type: 'number', description: '随机种子' },
        },
        required: ['prompt'],
      },
    },
  },
];

// ---------- 点兵虾 dispatcher ----------
const DISPATCHER_TOOLS: LLMFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'proactive_agent_node_health',
      description: '节点健康巡检 + 动态注入 Policy Tensor + 自动剔除死节点。',
      parameters: {
        type: 'object',
        properties: {
          node_ids: {
            type: 'string',
            description: '逗号分隔的节点 ID，空则全量',
          },
          policy_tensor_json: { type: 'string', description: '可选策略张量 JSON' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'auto_updater_run',
      description: '对边缘节点执行技能/依赖自动更新（如 cron）。',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'all | node_ids' },
          node_ids: { type: 'string', description: 'target=node_ids 时指定' },
        },
        required: ['target'],
      },
    },
  },
];

// ---------- 回声虾 echoer ----------
const ECHOER_TOOLS: LLMFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'humanizer_reply',
      description: '评论区回复真人化：高熵情绪、错别字、Emoji。',
      parameters: {
        type: 'object',
        properties: {
          reply_draft: { type: 'string', description: '待拟人化的回复草稿' },
          platform: { type: 'string', description: 'douyin | xiaohongshu | generic' },
          entropy_level: { type: 'string', description: 'low | medium | high', enum: ['low', 'medium', 'high'] },
        },
        required: ['reply_draft'],
      },
    },
  },
];

// ---------- 铁网虾 catcher ----------
const CATCHER_TOOLS: LLMFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'summarize_intent',
      description: '高意向评论快速提取 + NER 兜底，配合 ontology 做意图分类。',
      parameters: {
        type: 'object',
        properties: {
          comments_batch: {
            type: 'string',
            description: 'JSON 数组或换行分隔的评论列表',
          },
          extract_entities: { type: 'boolean', description: '是否抽取微信号/手机号/求购' },
        },
        required: ['comments_batch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ontology_extract_lead',
      description: '结构化提取微信号/手机号/求购意图，写入知识库。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '单条评论或私信' },
          upsert: { type: 'boolean', description: '是否写入 ontology' },
        },
        required: ['text'],
      },
    },
  },
];

// ---------- 金算虾 abacus ----------
const ABACUS_TOOLS: LLMFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'api_gateway_webhook',
      description: '一键连飞书/钉钉/CRM Webhook，推送 Hot Lead（可带 XAI 解释）。',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'feishu | dingtalk | custom_webhook',
            enum: ['feishu', 'dingtalk', 'custom_webhook'],
          },
          payload_json: {
            type: 'string',
            description: '线索 JSON：含 lead_id, score, xai_explanation 等',
          },
          webhook_url: { type: 'string', description: 'channel=custom_webhook 时必填' },
        },
        required: ['channel', 'payload_json'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gog_push_lead',
      description: '通过 Google Workspace / Gmail / Calendar 推送销售线索。',
      parameters: {
        type: 'object',
        properties: {
          lead_json: { type: 'string', description: '线索结构化数据' },
          destination: { type: 'string', description: 'gmail | calendar | sheet' },
        },
        required: ['lead_json', 'destination'],
      },
    },
  },
];

// ---------- 回访虾 follow-up ----------
const FOLLOWUP_TOOLS: LLMFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'openai_whisper_transcribe',
      description:
        '本地语音转文字 + VAD 打断检测，用于 WebRTC 实时倾听。结合 ElevenLabs TTS 做语音电销闭环。',
      parameters: {
        type: 'object',
        properties: {
          audio_input: {
            type: 'string',
            description: '音频 URL、base64 或本地路径',
          },
          language: { type: 'string', description: 'zh | en' },
          vad_enabled: { type: 'boolean', description: '是否启用 VAD 打断' },
        },
        required: ['audio_input'],
      },
    },
  },
];

const BY_AGENT: Record<ClawhubAgentId, LLMFunctionTool[]> = {
  radar: RADAR_TOOLS,
  strategist: STRATEGIST_TOOLS,
  'ink-writer': INKWRITER_TOOLS,
  visualizer: VISUALIZER_TOOLS,
  dispatcher: DISPATCHER_TOOLS,
  echoer: ECHOER_TOOLS,
  catcher: CATCHER_TOOLS,
  abacus: ABACUS_TOOLS,
  'follow-up': FOLLOWUP_TOOLS,
};

/**
 * 按 Agent 返回该 Agent 的 ClawHub Skill 对应的 OpenAPI Function 列表。
 * 注入前请确保已安装并调用 skill-vetter 审查各 skill。
 */
export function getClawhubToolsForAgent(agentId: ClawhubAgentId): LLMFunctionTool[] {
  return BY_AGENT[agentId] ?? [];
}

/**
 * 返回通用安全 tool（skill-vetter），应在所有 Agent 安装技能前注册。
 */
export function getUniversalSafetyTool(): LLMFunctionTool {
  return SKILL_VETTER_TOOL;
}

/**
 * 全部 Agent 的 Skill 映射（含 universal safety）。
 */
export const CLAWHUB_AGENT_TOOLS: Record<ClawhubAgentId | 'universal', LLMFunctionTool[]> = {
  universal: [SKILL_VETTER_TOOL],
  ...BY_AGENT,
};
