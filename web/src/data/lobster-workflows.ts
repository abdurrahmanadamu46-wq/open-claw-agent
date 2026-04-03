export type LobsterWorkflowStageId =
  | 'setup'
  | 'planning'
  | 'production'
  | 'dispatch'
  | 'conversion';

export type LobsterWorkflowMode = 'automatic' | 'approval' | 'hybrid';
export type LobsterWorkflowReadiness = 'implemented' | 'partial' | 'planned';

export interface LobsterWorkflowStage {
  id: LobsterWorkflowStageId;
  title: string;
  summary: string;
}

export interface LobsterWorkflowStep {
  id: number;
  stage: LobsterWorkflowStageId;
  title: string;
  detail: string;
  owners: string[];
  inputs: string[];
  output: string;
  mode: LobsterWorkflowMode;
  readiness: LobsterWorkflowReadiness;
  dependsOn: number[];
  backendAnchors: string[];
  successMetric: string;
}

export const LOBSTER_WORKFLOW_STAGES: LobsterWorkflowStage[] = [
  {
    id: 'setup',
    title: '准备层',
    summary: '先把行业、客户画像和租户记忆准备好，后面的 9 虾协同才不会空转。',
  },
  {
    id: 'planning',
    title: '策略层',
    summary: '从热点、竞品和合规约束里筛出真正能打的选题与执行窗口。',
  },
  {
    id: 'production',
    title: '内容生产层',
    summary: '把选题拆成文案、声音、分镜、标题与封面，形成可发布的资产包。',
  },
  {
    id: 'dispatch',
    title: '分发执行层',
    summary: '把内容、策略和任务计划统一归档，再按节点能力定向派发到边缘。',
  },
  {
    id: 'conversion',
    title: '转化闭环层',
    summary: '监视评论私信、线索评分、人工审批、电话跟进和反馈回传，形成闭环。',
  },
];

export const LOBSTER_WORKFLOW_STEPS: LobsterWorkflowStep[] = [
  {
    id: 1,
    stage: 'setup',
    title: '确认行业标签',
    detail: '执行行业标签勘探，并把租户绑定到对应行业知识池、策略模板和灰度策略。',
    owners: ['脑虫虾', '记忆治理'],
    inputs: ['行业大类', '细分行业', '租户信息'],
    output: '行业路由结果',
    mode: 'automatic',
    readiness: 'implemented',
    dependsOn: [],
    backendAnchors: ['industry-kb/bootstrap', 'industry_kb_context', 'tenant profile'],
    successMetric: '行业标签命中且知识池初始化成功',
  },
  {
    id: 2,
    stage: 'setup',
    title: '录入客户信息',
    detail: '沉淀客户痛点、解决方案、人设背景和竞争优势，写入租户记忆层。',
    owners: ['脑虫虾', '记忆治理'],
    inputs: ['痛点', '解决方案', '人设背景', '差异化优势'],
    output: '客户画像档案',
    mode: 'automatic',
    readiness: 'partial',
    dependsOn: [1],
    backendAnchors: ['TenantContext', 'strategist.memory', 'memory_governor'],
    successMetric: '画像字段完整且能被策略层复用',
  },
  {
    id: 3,
    stage: 'planning',
    title: '选题生成与评分',
    detail: '结合行业、竞品、客户画像与历史反馈，生成候选选题并按转化价值打分。',
    owners: ['触须虾', '脑虫虾', '金算虾'],
    inputs: ['行业标签', '客户画像', '竞品样本', '历史反馈'],
    output: '高分选题清单',
    mode: 'automatic',
    readiness: 'implemented',
    dependsOn: [1, 2],
    backendAnchors: ['radar', 'hotspot_investigation', 'strategist'],
    successMetric: '选题清单可解释且具备优先级',
  },
  {
    id: 4,
    stage: 'planning',
    title: '合规审核',
    detail: '对违规词、风险表述、夸大承诺与高风险动作做预审，必要时走 HITL。',
    owners: ['铁网虾', 'Guardian'],
    inputs: ['选题草案', '行业风险词库', '租户灰度策略'],
    output: '合规审核报告',
    mode: 'approval',
    readiness: 'implemented',
    dependsOn: [3],
    backendAnchors: ['constitutional_guardian', 'verification_gate', 'human_approval_gate'],
    successMetric: '风险结论清晰且审批链完整',
  },
  {
    id: 5,
    stage: 'production',
    title: '文案与声音生成',
    detail: '生成脚本、口播文案和声音资产，为分镜、字幕和封面提供统一母稿。',
    owners: ['吐墨虾', '回访虾'],
    inputs: ['高分选题', '客户画像', '合规结论'],
    output: '文案与语言资产',
    mode: 'automatic',
    readiness: 'partial',
    dependsOn: [4],
    backendAnchors: ['inkwriter', 'voice render'],
    successMetric: '脚本、口播和语气设定一致',
  },
  {
    id: 6,
    stage: 'production',
    title: '画面匹配与分镜',
    detail: '把文案拆成分镜，自动匹配画面元素、镜头节奏和视觉执行方案。',
    owners: ['幻影虾'],
    inputs: ['脚本母稿', '品牌素材', '行业视觉偏好'],
    output: '分镜素材包',
    mode: 'automatic',
    readiness: 'implemented',
    dependsOn: [5],
    backendAnchors: ['visualizer', 'ComfyUI', 'LibTV'],
    successMetric: '分镜结构完整且素材可直接生产',
  },
  {
    id: 7,
    stage: 'production',
    title: '字幕特效与配乐',
    detail: '根据脚本和镜头节奏自动生成字幕、特效和配乐建议，形成准成片。',
    owners: ['幻影虾', '吐墨虾'],
    inputs: ['分镜素材包', '口播音频', '品牌风格'],
    output: '成片草案',
    mode: 'automatic',
    readiness: 'partial',
    dependsOn: [5, 6],
    backendAnchors: ['media_post_pipeline', 'visualizer.voice', 'post plan'],
    successMetric: '成片节奏统一且可直接进入对比环节',
  },
  {
    id: 8,
    stage: 'production',
    title: '标题封面生成',
    detail: '输出多版标题、封面和首屏钩子，便于后续做效果对比与灰度发布。',
    owners: ['吐墨虾', '幻影虾'],
    inputs: ['脚本母稿', '分镜关键词', '行业转化词'],
    output: '标题封面组合',
    mode: 'automatic',
    readiness: 'partial',
    dependsOn: [5, 6],
    backendAnchors: ['inkwriter', 'visualizer', 'A/B variants'],
    successMetric: '至少形成可对比的多版本组合',
  },
  {
    id: 9,
    stage: 'dispatch',
    title: '云端归档',
    detail: '把内容资产、策略参数、合规结论和 trace 统一归档，为回放和复盘保留证据。',
    owners: ['点兵虾', '记忆治理'],
    inputs: ['文案', '分镜', '封面', '审批记录', 'trace'],
    output: '归档任务包',
    mode: 'automatic',
    readiness: 'implemented',
    dependsOn: [7, 8],
    backendAnchors: ['lossless_memory', 'kernel_persist_memory', 'agent-rag'],
    successMetric: '归档包可回放、可审计、可追责',
  },
  {
    id: 10,
    stage: 'dispatch',
    title: '下发边缘任务',
    detail: '根据节点技能、环境和调度优先级，把任务拆包后定向下发到边缘龙虾节点。',
    owners: ['点兵虾'],
    inputs: ['归档任务包', '节点技能清单', '发布计划'],
    output: '边缘执行计划',
    mode: 'automatic',
    readiness: 'implemented',
    dependsOn: [9],
    backendAnchors: ['dispatcher', 'clawteam_queue', 'edge_delivery_worker'],
    successMetric: '任务成功认领且分发链路可追踪',
  },
  {
    id: 11,
    stage: 'conversion',
    title: '监视评论私信',
    detail: '边缘节点持续监听评论区与私信，把意图事件回传给互动层和线索层。',
    owners: ['回声虾', '铁网虾'],
    inputs: ['边缘回传', '评论事件', '私信事件'],
    output: '线索事件流',
    mode: 'hybrid',
    readiness: 'partial',
    dependsOn: [10],
    backendAnchors: ['echoer', 'catcher', 'receive_dm_from_edge'],
    successMetric: '评论与私信事件能稳定进入线索流',
  },
  {
    id: 12,
    stage: 'conversion',
    title: '线索评分',
    detail: '按转化潜力、投诉风险、执行成功率和历史价值，对线索进行综合打分。',
    owners: ['金算虾'],
    inputs: ['线索事件流', '投诉信号', '交互上下文'],
    output: '线索评分结果',
    mode: 'automatic',
    readiness: 'implemented',
    dependsOn: [11],
    backendAnchors: ['abacus', 'policy_bandit'],
    successMetric: '线索分层明确且支持后续自动路由',
  },
  {
    id: 13,
    stage: 'conversion',
    title: '高分线索跟进',
    detail: '高分线索进入电话或人工跟进，必要时继续走 HITL 审批与子龙虾并发跟进。',
    owners: ['回访虾', 'Guardian'],
    inputs: ['A/B 级线索', '跟进策略', '审批结果'],
    output: '电话跟进记录',
    mode: 'approval',
    readiness: 'implemented',
    dependsOn: [12],
    backendAnchors: ['followup', 'followup_spawn', 'human_approval_gate'],
    successMetric: '高意向线索被及时认领并完成跟进',
  },
  {
    id: 14,
    stage: 'conversion',
    title: '飞书反馈与录音回传',
    detail: '对高意向客户自动回传飞书反馈摘要，并把录音、纪要和 trace 归并到云端。',
    owners: ['回访虾', '金算虾'],
    inputs: ['通话纪要', '录音文件', '线索评分结果'],
    output: '飞书反馈通知与录音附件',
    mode: 'hybrid',
    readiness: 'partial',
    dependsOn: [13],
    backendAnchors: ['followup_spawn', 'feishu_channel', 'lossless_memory'],
    successMetric: '销售反馈、录音和 trace 三者保持一致',
  },
];
