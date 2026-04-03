/**
 * Cloud Brain canonical roster for frontend presentation.
 *
 * This file is the frontend-facing roster adapter aligned to:
 * - Commander as a first-class top brain
 * - 9 elders as the senate seats
 * - feedback as a support kernel, not a seat
 *
 * Compatibility rule:
 * - old aliases like `ink-writer` and `follow-up` should be normalized
 * - UI-facing seat IDs should use canonical runtime IDs
 */

export type AgentIconName =
  | 'Brain'
  | 'ScanSearch'
  | 'PenLine'
  | 'Image'
  | 'Send'
  | 'MessageCircle'
  | 'Filter'
  | 'Calculator'
  | 'Phone';

export type CustomLobsterAgentId =
  | 'radar'
  | 'strategist'
  | 'inkwriter'
  | 'visualizer'
  | 'dispatcher'
  | 'echoer'
  | 'catcher'
  | 'abacus'
  | 'followup';

export type CloudBrainRoleId = 'commander' | CustomLobsterAgentId | 'feedback';

export interface CustomLobsterAgent {
  id: CustomLobsterAgentId;
  icon: AgentIconName;
  name: string;
  description: string;
  codename: string;
  personality: string;
  skills: string[];
  statusPhrases: string[];
}

export interface CloudBrainRoleDescriptor {
  id: CloudBrainRoleId;
  canonicalId: string;
  icon: AgentIconName;
  name: string;
  seatTitle: string;
  description: string;
  codename: string;
  aliases: string[];
  roleType: 'commander' | 'elder' | 'support-kernel';
}

export const CLOUD_BRAIN_COMMANDER: CloudBrainRoleDescriptor = {
  id: 'commander',
  canonicalId: 'commander',
  icon: 'Brain',
  name: '元老院总脑',
  seatTitle: 'Commander',
  description: '负责目标解释、阵容编排、审批门控、止损与结果收束。',
  codename: 'Senate Commander / Supreme Orchestrator',
  aliases: ['commander', 'senate-commander', '总脑', '指挥官'],
  roleType: 'commander',
};

export const CUSTOM_LOBSTER_AGENTS: CustomLobsterAgent[] = [
  {
    id: 'radar',
    icon: 'ScanSearch',
    name: '触须虾',
    description: '负责外部信号、竞品、热点与规则变化扫描。',
    codename: 'Radar / Research Scout',
    personality: '证据优先，先扫全局，再过滤噪音，只把高价值信号上报给总脑。',
    skills: ['竞品扫描', '热点提取', '规则变化识别'],
    statusPhrases: ['扫描竞品中...', '聚合同城信号...', '识别值得放大的线索...', '准备交给 Strategist...'],
  },
  {
    id: 'strategist',
    icon: 'Brain',
    name: '策士虾',
    description: '负责目标拆解、路线设计、优先级与增长策略。',
    codename: 'Strategist / Growth Planner',
    personality: '先定路线，再定动作；优先解决最值钱的问题。',
    skills: ['目标拆解', '增长路线', '优先级设计'],
    statusPhrases: ['整理目标约束...', '规划增长路线...', '生成策略参数...', '准备移交内容和执行层...'],
  },
  {
    id: 'inkwriter',
    icon: 'PenLine',
    name: '吐墨虾',
    description: '负责脚本、文案、口播和转化话术生成。',
    codename: 'InkWriter / Conversion Copy',
    personality: '先确保能转化，再追求表达力和传播性。',
    skills: ['脚本生成', '文案润色', '成交话术'],
    statusPhrases: ['整理脚本结构...', '补强开场钩子...', '统一品牌口吻...', '输出可执行文案包...'],
  },
  {
    id: 'visualizer',
    icon: 'Image',
    name: '幻影虾',
    description: '负责分镜、画面提示、封面与视觉路线。',
    codename: 'Visualizer / Storyboard Director',
    personality: '先建立可信感，再建立高级感和点击欲望。',
    skills: ['分镜设计', '视觉提示词', '封面路线'],
    statusPhrases: ['规划分镜...', '生成视觉路线...', '整理画面提示...', '移交素材计划...'],
  },
  {
    id: 'dispatcher',
    icon: 'Send',
    name: '点兵虾',
    description: '负责任务拆包、依赖编排、分发与回放补偿。',
    codename: 'Dispatcher / Task Router',
    personality: '先保稳定，再追求速度和并发效率。',
    skills: ['任务拆包', '依赖调度', '边缘分发'],
    statusPhrases: ['拆分任务包...', '安排执行顺序...', '校验分发约束...', '等待回执...'],
  },
  {
    id: 'echoer',
    icon: 'MessageCircle',
    name: '回声虾',
    description: '负责互动回复、评论承接和信任建立。',
    codename: 'Echoer / Engagement Voice',
    personality: '像真人，有温度，能承接情绪，也能导向下一步动作。',
    skills: ['评论承接', '互动回复', '情绪调节'],
    statusPhrases: ['扫描互动上下文...', '生成回复话术...', '调整语气和风险边界...', '等待线索反馈...'],
  },
  {
    id: 'catcher',
    icon: 'Filter',
    name: '铁网虾',
    description: '负责意向识别、线索过滤和高意向放行。',
    codename: 'Catcher / Lead Gate',
    personality: '宁可少放，也不乱放；只让真正值得跟进的线索通过。',
    skills: ['意向识别', '预算判断', '风险过滤'],
    statusPhrases: ['识别意向强度...', '过滤低质线索...', '标记优先级...', '准备交给 Abacus...'],
  },
  {
    id: 'abacus',
    icon: 'Calculator',
    name: '算盘虾',
    description: '负责线索评分、归因、价值计算与反馈回写。',
    codename: 'Abacus / Value Scorer',
    personality: '一切围绕价值、ROI 和长期复利。',
    skills: ['线索评分', 'ROI 归因', '反馈回写'],
    statusPhrases: ['计算线索价值...', '更新归因结果...', '回写奖励信号...', '决定是否推进回访...'],
  },
  {
    id: 'followup',
    icon: 'Phone',
    name: '回访虾',
    description: '负责高意向跟进、预约推进与成交。',
    codename: 'FollowUp / Conversion Closer',
    personality: '判断窗口、推进动作、持续跟进直到结果明确。',
    skills: ['跟进推进', '预约承接', '再激活'],
    statusPhrases: ['整理跟进计划...', '推进预约动作...', '执行高意向回访...', '回传成交结果...'],
  },
];

export const CLOUD_BRAIN_SUPPORT_ROLES: CloudBrainRoleDescriptor[] = [
  {
    id: 'feedback',
    canonicalId: 'feedback',
    icon: 'Brain',
    name: '反馈内核',
    seatTitle: 'Feedback Kernel',
    description: '负责复盘、进化、经验回写与策略修正。',
    codename: 'Feedback Kernel / Evolution Loop',
    aliases: ['feedback', '反馈内核', '反馈虾'],
    roleType: 'support-kernel',
  },
];

export const CLOUD_BRAIN_ROSTER: CloudBrainRoleDescriptor[] = [
  CLOUD_BRAIN_COMMANDER,
  ...CUSTOM_LOBSTER_AGENTS.map((agent) => ({
    id: agent.id,
    canonicalId: agent.id,
    icon: agent.icon,
    name: agent.name,
    seatTitle: agent.codename.split('/')[0]?.trim() || agent.codename,
    description: agent.description,
    codename: agent.codename,
    aliases:
      agent.id === 'inkwriter'
        ? ['inkwriter', 'ink-writer', 'ink_writer', agent.name]
        : agent.id === 'followup'
          ? ['followup', 'follow-up', 'follow_up', agent.name]
          : [agent.id, agent.name],
    roleType: 'elder' as const,
  })),
];

export function normalizeCustomLobsterAgentId(id: string | undefined): CustomLobsterAgentId | undefined {
  const raw = String(id || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'ink-writer' || raw === 'ink_writer') return 'inkwriter';
  if (raw === 'follow-up' || raw === 'follow_up') return 'followup';
  if (
    raw === 'radar' ||
    raw === 'strategist' ||
    raw === 'inkwriter' ||
    raw === 'visualizer' ||
    raw === 'dispatcher' ||
    raw === 'echoer' ||
    raw === 'catcher' ||
    raw === 'abacus' ||
    raw === 'followup'
  ) {
    return raw;
  }
  return undefined;
}

export function getCustomLobsterAgent(id: CustomLobsterAgentId | string | undefined): CustomLobsterAgent | undefined {
  const normalized = normalizeCustomLobsterAgentId(String(id || ''));
  return normalized ? CUSTOM_LOBSTER_AGENTS.find((item) => item.id === normalized) : undefined;
}

export function getCloudBrainRole(id: CloudBrainRoleId | string | undefined): CloudBrainRoleDescriptor | undefined {
  const raw = String(id || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'commander' || raw === 'senate-commander' || raw === '总脑' || raw === '指挥官') {
    return CLOUD_BRAIN_COMMANDER;
  }
  if (raw === 'feedback' || raw === '反馈内核' || raw === '反馈虾') {
    return CLOUD_BRAIN_SUPPORT_ROLES[0];
  }
  const elder = getCustomLobsterAgent(raw);
  if (!elder) return undefined;
  return CLOUD_BRAIN_ROSTER.find((item) => item.id === elder.id);
}

export function getAgentStatusPhrase(agent: CustomLobsterAgent, seed: number): string {
  const idx = Math.floor(seed % agent.statusPhrases.length);
  return agent.statusPhrases[idx] ?? agent.statusPhrases[0];
}
