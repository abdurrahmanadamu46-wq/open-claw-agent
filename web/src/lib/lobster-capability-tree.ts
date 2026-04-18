import { getLobsterRoleMeta, type LobsterRoleMeta } from '@/lib/lobster-skills';

export type LobsterCapabilityLeaf = {
  id: string;
  title: string;
  summary: string;
  status: 'active' | 'growing' | 'planned';
};

export type LobsterCapabilityProfile = {
  role: LobsterRoleMeta;
  mission: string;
  manages: LobsterCapabilityLeaf[];
  knowledgeSurfaces: string[];
  executionSurfaces: string[];
  collaborationSurfaces: string[];
  governanceSurfaces: string[];
};

const CAPABILITY_MAP: Record<string, Omit<LobsterCapabilityProfile, 'role'>> = {
  commander: {
    mission: '统筹平台脑与租户总控台之间的目标解释、资源仲裁、风险止损和结果收束。',
    manages: [
      { id: 'mission_router', title: '任务编排官', summary: '决定主管龙虾出场顺序与任务主链。', status: 'active' },
      { id: 'risk_gate', title: '止损与门禁官', summary: '把审批、阻断、放行和恢复纳入统一裁决。', status: 'active' },
      { id: 'postmortem_loop', title: '复盘进化官', summary: '把结果和异常重新反馈给训练链。', status: 'growing' },
    ],
    knowledgeSurfaces: ['平台行业知识', '租户知识库', '策略模板', '经验沉淀'],
    executionSurfaces: ['总控台', '治理中心'],
    collaborationSurfaces: ['群播报', '审批确认', '对客同步'],
    governanceSurfaces: ['审批中心', '上线门禁', '恢复决策'],
  },
  radar: {
    mission: '负责发现外部信号，把市场变化、竞品动作和异常趋势转成可训练的输入。',
    manages: [
      { id: 'trend_scout', title: '热点扫描员', summary: '抓热词、热选题和平台信号。', status: 'active' },
      { id: 'competitor_watch', title: '竞品监听员', summary: '观察竞品内容变化、频率和结构。', status: 'active' },
      { id: 'comment_intel', title: '评论情报员', summary: '从评论区和舆情里提炼训练素材。', status: 'growing' },
    ],
    knowledgeSurfaces: ['平台行业知识', '竞品公式库', 'Prompt 能力包'],
    executionSurfaces: ['对标雷达', '练兵场'],
    collaborationSurfaces: ['群播报摘要'],
    governanceSurfaces: ['风险扫描结果'],
  },
  strategist: {
    mission: '负责把目标、行业事实和风险边界编排成一条真正能推进的增长路线。',
    manages: [
      { id: 'route_planner', title: '路线设计师', summary: '拆目标、定主线、排优先级。', status: 'active' },
      { id: 'experiment_designer', title: '实验编排员', summary: '把练兵任务拆成可比较的策略方案。', status: 'growing' },
      { id: 'governance_planner', title: '治理约束员', summary: '把审批和外部边界写进策略。', status: 'planned' },
    ],
    knowledgeSurfaces: ['平台行业知识', '租户知识库', '经验沉淀'],
    executionSurfaces: ['策略编排', '工作流模板'],
    collaborationSurfaces: ['待确认项'],
    governanceSurfaces: ['上线闸门', '策略治理'],
  },
  inkwriter: {
    mission: '负责把策略翻译成脚本、文案、钩子、承接话术和可投放表达。',
    manages: [
      { id: 'hook_writer', title: '开场钩子师', summary: '负责前 3 秒吸引和标题封面承接。', status: 'active' },
      { id: 'comment_copy', title: '评论承接文案师', summary: '把互动推向私信和预约。', status: 'growing' },
      { id: 'close_copy', title: '成交话术师', summary: '组织转化和预约推进文案。', status: 'planned' },
    ],
    knowledgeSurfaces: ['Prompt 能力包', '租户知识库', '经验沉淀'],
    executionSurfaces: ['内容生产', '工件成果'],
    collaborationSurfaces: ['群播报素材'],
    governanceSurfaces: ['内容风险边界'],
  },
  visualizer: {
    mission: '负责把脚本变成分镜、视觉提示、素材路线和画面组织方式。',
    manages: [
      { id: 'storyboard_director', title: '分镜导演', summary: '组织镜头顺序与视觉节奏。', status: 'active' },
      { id: 'cover_designer', title: '封面策划师', summary: '组织首屏点击和封面表达。', status: 'growing' },
      { id: 'asset_curator', title: '素材整编师', summary: '把素材来源、提示词和执行约束统一。', status: 'planned' },
    ],
    knowledgeSurfaces: ['Prompt 能力包', '视觉模板', '经验沉淀'],
    executionSurfaces: ['内容生产', '本地执行素材链'],
    collaborationSurfaces: ['群播报预览图'],
    governanceSurfaces: ['视觉合规'],
  },
  dispatcher: {
    mission: '负责把云端任务链变成真正可下发、可恢复、可回执的本地执行计划。',
    manages: [
      { id: 'queue_router', title: '调度排班员', summary: '决定什么先发、什么并行、什么等待。', status: 'active' },
      { id: 'edge_dispatcher', title: '边缘下发员', summary: '把执行包分配到具体节点和时间窗。', status: 'active' },
      { id: 'receipt_collector', title: '回执收集员', summary: '收心跳、回执和恢复动作。', status: 'growing' },
    ],
    knowledgeSurfaces: ['执行模板', '节点规则', '经验沉淀'],
    executionSurfaces: ['Fleet', 'Scheduler', 'Monitor', 'Manual Publish'],
    collaborationSurfaces: ['执行播报'],
    governanceSurfaces: ['恢复与回放'],
  },
  echoer: {
    mission: '负责对外互动语气、评论承接和群协作里的温度表达。',
    manages: [
      { id: 'reply_operator', title: '评论承接员', summary: '负责评论区与互动承接。', status: 'active' },
      { id: 'tone_guard', title: '语气调节员', summary: '让输出更像真人而不是脚本机。', status: 'growing' },
      { id: 'group_broadcaster', title: '群播报助手', summary: '把状态播报包装成可读消息。', status: 'planned' },
    ],
    knowledgeSurfaces: ['Prompt 能力包', '租户知识库'],
    executionSurfaces: ['互动承接', '群协作'],
    collaborationSurfaces: ['群播报', '待确认项'],
    governanceSurfaces: ['表达风险控制'],
  },
  catcher: {
    mission: '负责过滤噪音、识别高意向对象，并决定哪些线索应该继续流入成交链。',
    manages: [
      { id: 'intent_filter', title: '高意向过滤员', summary: '负责识别值得继续投入的人。', status: 'active' },
      { id: 'risk_filter', title: '风险放行员', summary: '先阻断噪音，再放行高价值线索。', status: 'active' },
      { id: 'tag_operator', title: '客户标签员', summary: '把线索结构化进 CRM。', status: 'growing' },
    ],
    knowledgeSurfaces: ['租户知识库', '经验沉淀'],
    executionSurfaces: ['线索池', 'CRM'],
    collaborationSurfaces: ['群内确认'],
    governanceSurfaces: ['高风险放行规则'],
  },
  abacus: {
    mission: '负责把成交概率、价值、归因和反馈回写变成量化决策，而不是感觉判断。',
    manages: [
      { id: 'value_scorer', title: '价值评分员', summary: '评估 ROI 和优先级。', status: 'active' },
      { id: 'attribution_analyst', title: '归因分析员', summary: '解释线索和动作的价值来源。', status: 'active' },
      { id: 'feedback_writer', title: '反馈回写员', summary: '把结果送回训练与治理链。', status: 'growing' },
    ],
    knowledgeSurfaces: ['经验沉淀', '租户知识库'],
    executionSurfaces: ['线索评分', '分析面板'],
    collaborationSurfaces: ['群复盘摘要'],
    governanceSurfaces: ['策略治理', '商业化门禁'],
  },
  followup: {
    mission: '负责把高意向对象推进到预约、外呼、成交或再激活，而不是停在回收联系方式。',
    manages: [
      { id: 'first_touch', title: '首轮推进员', summary: '负责第一次高意向跟进。', status: 'active' },
      { id: 'booking_driver', title: '预约推进员', summary: '把意向推进到明确动作。', status: 'growing' },
      { id: 'reactivation_driver', title: '再激活员', summary: '负责沉默线索再唤醒。', status: 'planned' },
    ],
    knowledgeSurfaces: ['租户知识库', '成交话术', '经验沉淀'],
    executionSurfaces: ['跟进工作台', '电话与回访'],
    collaborationSurfaces: ['群内确认', '客户同步'],
    governanceSurfaces: ['审批中心', '风险触达边界'],
  },
  feedback: {
    mission: '负责复盘、异常恢复、经验升维和下一轮策略修正。',
    manages: [
      { id: 'trace_reviewer', title: 'Trace 复盘员', summary: '把证据链拉平给 operator 看。', status: 'active' },
      { id: 'rollback_planner', title: '恢复计划员', summary: '决定何时回滚、何时补偿。', status: 'growing' },
      { id: 'memory_curator', title: '经验升维员', summary: '把结果回写到知识与记忆层。', status: 'growing' },
    ],
    knowledgeSurfaces: ['经验沉淀', '平台行业知识'],
    executionSurfaces: ['Trace', '治理中心'],
    collaborationSurfaces: ['复盘播报'],
    governanceSurfaces: ['恢复 / 回放'],
  },
};

export function getLobsterCapabilityProfile(roleId: string): LobsterCapabilityProfile {
  const role = getLobsterRoleMeta(roleId);
  const fallback = CAPABILITY_MAP[roleId] ?? {
    mission: role.summary,
    manages: [],
    knowledgeSurfaces: ['租户知识库'],
    executionSurfaces: ['总控台'],
    collaborationSurfaces: ['群协作'],
    governanceSurfaces: ['治理中心'],
  };

  return {
    role,
    ...fallback,
  };
}

export function hasLobsterCapabilityProfile(roleId: string): boolean {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_MAP, roleId);
}
