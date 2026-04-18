export const OUTPUT_FORMATS = ['alert', 'digest', 'comparison', 'analysis'] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export type LobsterStageKey =
  | 'global'
  | 'signal'
  | 'strategy'
  | 'copy'
  | 'visual'
  | 'dispatch'
  | 'engage'
  | 'followup'
  | 'review';

export type LobsterRoleMeta = {
  id: string;
  zhName: string;
  enName: string;
  label: string;
  icon: string;
  stageKey: LobsterStageKey;
  stageLabel: string;
  stageIndex: string;
  artifact: string;
  summary: string;
  expectedSkillCount: number;
  representativeSkills: string[];
  upstreamIds: string[];
  downstreamIds: string[];
};

export type LobsterPipelineStage = {
  key: LobsterStageKey;
  label: string;
  description: string;
  ownerIds: string[];
  artifacts: string[];
  representativeSkills: string[];
  upstreamStageKeys: LobsterStageKey[];
  downstreamStageKeys: LobsterStageKey[];
  semanticSource: 'frontend_shared';
};

const ROLE_ORDER = [
  'commander',
  'radar',
  'strategist',
  'inkwriter',
  'visualizer',
  'dispatcher',
  'echoer',
  'catcher',
  'followup',
  'abacus',
] as const;

const ROLE_META: Record<string, LobsterRoleMeta> = {
  commander: {
    id: 'commander',
    zhName: '元老院总脑',
    enName: 'Commander',
    label: '元老院总脑 Commander',
    icon: '👑',
    stageKey: 'global',
    stageLabel: '全局编排',
    stageIndex: '00',
    artifact: 'MissionPlan',
    summary: '全链路编排、异常中断、资源仲裁与自动复盘，只指挥不替龙虾干活。',
    expectedSkillCount: 6,
    representativeSkills: ['mission routing', 'resource arbitration', 'postmortem loop'],
    upstreamIds: [],
    downstreamIds: ['radar', 'strategist', 'dispatcher'],
  },
  radar: {
    id: 'radar',
    zhName: '触须虾',
    enName: 'Radar',
    label: '触须虾 Radar',
    icon: '📡',
    stageKey: 'signal',
    stageLabel: '信号发现',
    stageIndex: '01',
    artifact: 'SignalBrief',
    summary: '追踪热点、竞品和舆情，把噪音过滤成可用情报。',
    expectedSkillCount: 8,
    representativeSkills: ['signal scan', 'competitor watch', 'sentiment alert'],
    upstreamIds: ['commander'],
    downstreamIds: ['strategist'],
  },
  strategist: {
    id: 'strategist',
    zhName: '脑虫虾',
    enName: 'Strategist',
    label: '脑虫虾 Strategist',
    icon: '🧠',
    stageKey: 'strategy',
    stageLabel: '策略制定',
    stageIndex: '02',
    artifact: 'StrategyRoute',
    summary: '把目标拆解成行业化路线、节奏、预算和治理约束。',
    expectedSkillCount: 7,
    representativeSkills: ['goal decompose', 'content calendar', 'adaptive adjust'],
    upstreamIds: ['commander', 'radar'],
    downstreamIds: ['inkwriter', 'visualizer', 'dispatcher'],
  },
  inkwriter: {
    id: 'inkwriter',
    zhName: '吐墨虾',
    enName: 'InkWriter',
    label: '吐墨虾 InkWriter',
    icon: '✒️',
    stageKey: 'copy',
    stageLabel: '文案生产',
    stageIndex: '03-A',
    artifact: 'CopyPack',
    summary: '把策略变成跨平台文案、话术和风控合规内容包。',
    expectedSkillCount: 5,
    representativeSkills: ['copy generate', 'banned word check', 'dm script'],
    upstreamIds: ['strategist'],
    downstreamIds: ['dispatcher', 'echoer'],
  },
  visualizer: {
    id: 'visualizer',
    zhName: '幻影虾',
    enName: 'Visualizer',
    label: '幻影虾 Visualizer',
    icon: '🎬',
    stageKey: 'visual',
    stageLabel: '视觉生产',
    stageIndex: '03-B',
    artifact: 'StoryboardPack',
    summary: '负责分镜、图片、数字人视频、字幕和后期素材的视觉闭环。',
    expectedSkillCount: 8,
    representativeSkills: ['storyboard', 'image gen', 'digital human video'],
    upstreamIds: ['strategist'],
    downstreamIds: ['dispatcher'],
  },
  dispatcher: {
    id: 'dispatcher',
    zhName: '点兵虾',
    enName: 'Dispatcher',
    label: '点兵虾 Dispatcher',
    icon: '📦',
    stageKey: 'dispatch',
    stageLabel: '分发调度',
    stageIndex: '04',
    artifact: 'ExecutionPlan',
    summary: '把内容拆成可执行包，调度账号、时间窗和边缘执行器。',
    expectedSkillCount: 4,
    representativeSkills: ['task split', 'scheduled publish', 'multi-account rotate'],
    upstreamIds: ['strategist', 'inkwriter', 'visualizer'],
    downstreamIds: ['echoer', 'catcher', 'followup'],
  },
  echoer: {
    id: 'echoer',
    zhName: '回声虾',
    enName: 'Echoer',
    label: '回声虾 Echoer',
    icon: '💬',
    stageKey: 'engage',
    stageLabel: '互动承接',
    stageIndex: '05-A',
    artifact: 'EngagementReplyPack',
    summary: '承接评论和私信，把互动转成更高质量的深聊与引流。',
    expectedSkillCount: 4,
    representativeSkills: ['reply generate', 'comment manage', 'wechat funnel'],
    upstreamIds: ['dispatcher', 'inkwriter'],
    downstreamIds: ['catcher', 'followup'],
  },
  catcher: {
    id: 'catcher',
    zhName: '铁网虾',
    enName: 'Catcher',
    label: '铁网虾 Catcher',
    icon: '🎯',
    stageKey: 'engage',
    stageLabel: '线索识别',
    stageIndex: '05-B',
    artifact: 'LeadAssessment',
    summary: '识别高意向对象、去重、入库，并把结果推给跟进和复盘。',
    expectedSkillCount: 3,
    representativeSkills: ['lead score', 'crm push', 'cross-platform dedup'],
    upstreamIds: ['dispatcher', 'echoer'],
    downstreamIds: ['followup', 'abacus'],
  },
  followup: {
    id: 'followup',
    zhName: '回访虾',
    enName: 'FollowUp',
    label: '回访虾 FollowUp',
    icon: '🔄',
    stageKey: 'followup',
    stageLabel: '跟进成交',
    stageIndex: '06',
    artifact: 'FollowUpActionPlan',
    summary: '把高价值对象推进到成交、预约或再次唤醒，并回写结果。',
    expectedSkillCount: 3,
    representativeSkills: ['sop generate', 'multi touch', 'dormant wake'],
    upstreamIds: ['dispatcher', 'echoer', 'catcher'],
    downstreamIds: ['abacus'],
  },
  feedback: {
    id: 'feedback',
    zhName: '反馈内核',
    enName: 'Feedback',
    label: '反馈内核 Feedback',
    icon: '📊',
    stageKey: 'review',
    stageLabel: '复盘反馈',
    stageIndex: '07-K',
    artifact: 'TraceReviewReport',
    summary: '负责复盘、回滚判断、经验回写与反馈升维的内核角色。',
    expectedSkillCount: 3,
    representativeSkills: ['trace analysis', 'rollback judge', 'launch gate'],
    upstreamIds: ['dispatcher', 'followup', 'abacus'],
    downstreamIds: ['commander', 'strategist'],
  },
  abacus: {
    id: 'abacus',
    zhName: '金算虾',
    enName: 'Abacus',
    label: '金算虾 Abacus',
    icon: '🧮',
    stageKey: 'review',
    stageLabel: '复盘反馈',
    stageIndex: '07',
    artifact: 'ValueScoreCard',
    summary: '做多触点归因、价值分和策略复盘，把经验回流给前链路。',
    expectedSkillCount: 4,
    representativeSkills: ['roi calc', 'attribution', 'feedback loop'],
    upstreamIds: ['catcher', 'followup'],
    downstreamIds: ['commander', 'radar', 'strategist'],
  },
};

const PIPELINE_STAGE_ORDER: Array<Exclude<LobsterStageKey, 'global'>> = [
  'signal',
  'strategy',
  'copy',
  'visual',
  'dispatch',
  'engage',
  'followup',
  'review',
];

const PIPELINE_STAGE_META: Record<Exclude<LobsterStageKey, 'global'>, { label: string; description: string }> = {
  signal: {
    label: '01 信号发现',
    description: '先找增量机会，再把有价值的信号送入策略主链。',
  },
  strategy: {
    label: '02 策略制定',
    description: '把行业事实、目标和风险边界编成可执行路线。',
  },
  copy: {
    label: '03-A 文案生产',
    description: '把策略落成各平台可发布、可转化、可审计的文案包。',
  },
  visual: {
    label: '03-B 视觉生产',
    description: '把脚本变成分镜、图片、数字人视频和后期素材。',
  },
  dispatch: {
    label: '04 分发调度',
    description: '决定何时、由谁、在哪个账号与边缘节点执行。',
  },
  engage: {
    label: '05 互动与线索',
    description: '先承接互动，再把高意向线索送入跟进与复盘。',
  },
  followup: {
    label: '06 跟进成交',
    description: '跨触点跟进高价值对象，把成交和唤醒结果回写。',
  },
  review: {
    label: '07 复盘反馈',
    description: '把 attribution、价值分和结论反哺给下一轮增长。',
  },
};

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
}

function sortStageKeys(stageKeys: LobsterStageKey[]): LobsterStageKey[] {
  return Array.from(new Set(stageKeys))
    .filter((key): key is Exclude<LobsterStageKey, 'global'> => PIPELINE_STAGE_ORDER.includes(key as Exclude<LobsterStageKey, 'global'>))
    .sort(
      (left, right) =>
        PIPELINE_STAGE_ORDER.indexOf(left as Exclude<LobsterStageKey, 'global'>)
        - PIPELINE_STAGE_ORDER.indexOf(right as Exclude<LobsterStageKey, 'global'>),
    );
}

function buildLobsterPipelineStages(): LobsterPipelineStage[] {
  return PIPELINE_STAGE_ORDER.map((stageKey) => {
    const owners = ROLE_ORDER.map((roleId) => ROLE_META[roleId]).filter((role) => role.stageKey === stageKey);
    const artifacts = uniqueStrings(owners.map((owner) => owner.artifact));
    const representativeSkills = uniqueStrings(owners.flatMap((owner) => owner.representativeSkills)).slice(0, 6);
    const upstreamStageKeys = sortStageKeys(
      owners.flatMap((owner) =>
        owner.upstreamIds
          .map((agentId) => ROLE_META[agentId as keyof typeof ROLE_META]?.stageKey)
          .filter((value): value is LobsterStageKey => Boolean(value) && value !== stageKey && value !== 'global'),
      ),
    );
    const downstreamStageKeys = sortStageKeys(
      owners.flatMap((owner) =>
        owner.downstreamIds
          .map((agentId) => ROLE_META[agentId as keyof typeof ROLE_META]?.stageKey)
          .filter((value): value is LobsterStageKey => Boolean(value) && value !== stageKey && value !== 'global'),
      ),
    );

    return {
      key: stageKey,
      label: PIPELINE_STAGE_META[stageKey].label,
      description: PIPELINE_STAGE_META[stageKey].description,
      ownerIds: owners.map((owner) => owner.id),
      artifacts,
      representativeSkills,
      upstreamStageKeys,
      downstreamStageKeys,
      semanticSource: 'frontend_shared',
    };
  });
}

export const LOBSTER_PIPELINE_STAGES: LobsterPipelineStage[] = buildLobsterPipelineStages();

export function getLobsterPipelineStage(stageKey: LobsterStageKey): LobsterPipelineStage | null {
  return LOBSTER_PIPELINE_STAGES.find((stage) => stage.key === stageKey) ?? null;
}

export function getLobsterRoleMeta(agentId: string): LobsterRoleMeta {
  const known = ROLE_META[agentId];
  if (known) return known;
  return {
    id: agentId,
    zhName: agentId,
    enName: agentId,
    label: agentId,
    icon: '🦞',
    stageKey: 'global',
    stageLabel: '未归档角色',
    stageIndex: '--',
    artifact: 'UnknownArtifact',
    summary: '当前角色未录入前端角色手册，先以运行时返回结果为准。',
    expectedSkillCount: 0,
    representativeSkills: [],
    upstreamIds: [],
    downstreamIds: [],
  };
}

export function getAllKnownLobsterRoles(): LobsterRoleMeta[] {
  return ROLE_ORDER.map((id) => ROLE_META[id]);
}

export function orderAgentIds(agentIds: string[]): string[] {
  const known = ROLE_ORDER.filter((id) => agentIds.includes(id));
  const extras = agentIds
    .filter((id) => !ROLE_ORDER.includes(id as (typeof ROLE_ORDER)[number]))
    .sort((a, b) => a.localeCompare(b));
  return [...known, ...extras];
}
