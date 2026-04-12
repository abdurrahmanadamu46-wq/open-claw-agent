/**
 * LangGraph 多智能体调度图：Scout -> Director -> (条件) -> Publish / 重试 / 失败
 * 自我纠错：Director 输出格式校验不通过时打回 Director，最多重试 3 次
 */

import { Annotation, START, END, StateGraph } from '@langchain/langgraph';
import type {
  AgentWorkflowState,
  CompetitorData,
  DraftScript,
  DraftScriptScene,
  FinalActionPayload,
} from './agent-workflow.types';
import { MAX_DIRECTOR_RETRIES } from './agent-workflow.types';

// ----- 图状态定义 (Step 1) -----

const WorkflowStateAnnotation = Annotation.Root({
  tenantId: Annotation<string>(),
  rawTaskInput: Annotation<string>(),
  competitorData: Annotation<CompetitorData | null>(),
  draftScript: Annotation<DraftScript | null>(),
  errorLog: Annotation<string[]>({
    reducer: (left: string[], right: string[] | string) => {
      const next = Array.isArray(right) ? right : [right];
      return left.concat(next);
    },
    default: () => [],
  }),
  directorRetryCount: Annotation<number>(),
  finalActionPayload: Annotation<FinalActionPayload | null>(),
  validationPassed: Annotation<boolean>(),
});

export type WorkflowState = typeof WorkflowStateAnnotation.State;

// ----- 分镜脚本校验（用于条件边） -----

const MIN_SCENES = 1;
const MAX_SCENES = 30;

function validateDraftScript(script: DraftScript | null): { ok: boolean; message?: string } {
  if (!script || typeof script !== 'object') {
    return { ok: false, message: 'draftScript 为空或非对象' };
  }
  if (!Array.isArray(script.scenes)) {
    return { ok: false, message: 'draftScript.scenes 必须为数组' };
  }
  if (script.scenes.length < MIN_SCENES || script.scenes.length > MAX_SCENES) {
    return { ok: false, message: `scenes 数量须在 ${MIN_SCENES}～${MAX_SCENES} 之间，当前 ${script.scenes.length}` };
  }
  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (!scene || typeof scene !== 'object') {
      return { ok: false, message: `scenes[${i}] 须为对象` };
    }
    if (typeof (scene as DraftScriptScene).text !== 'string') {
      return { ok: false, message: `scenes[${i}].text 须为字符串` };
    }
    const idx = (scene as DraftScriptScene).index;
    if (typeof idx !== 'number' || idx !== i + 1) {
      return { ok: false, message: `scenes[${i}].index 须为数字且等于 ${i + 1}` };
    }
  }
  return { ok: true };
}

// ----- Step 2: 三大核心节点 -----

/** 侦察 Agent：分析竞品数据，提取核心钩子和痛点 */
async function ScoutNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  // 占位：实际可调用 LLM 或已有侦察服务，这里根据 rawTaskInput 构造示例情报
  const competitorData: CompetitorData = {
    hooks: ['价格透明', '快速响应'],
    pain_points: ['比价繁琐', '售后不清晰'],
    summary: `基于任务「${state.rawTaskInput}」的竞品情报摘要`,
  };
  return {
    competitorData,
  };
}

/** 编导 Agent：根据侦察结果按语意断句生成分镜脚本 JSON */
async function DirectorNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const prevErrors = state.errorLog?.length ? state.errorLog.join('；') : '';
  const hints = prevErrors ? `\n上一轮错误（请修正）：${prevErrors}` : '';

  // 占位：实际应调用 LLM，严格按语意断句规则生成；这里返回符合格式的示例
  const draftScript: DraftScript = {
    template_type: '15秒故事带货',
    scenes: [
      { index: 1, text: '开头钩子：解决你的比价烦恼', type: 'hook' },
      { index: 2, text: '痛点：比价繁琐、售后不清晰', type: 'pain_point' },
      { index: 3, text: '卖点：价格透明、快速响应', type: 'cta' },
    ],
  };

  return {
    draftScript,
    // 重试时清空本轮前的 errorLog 由 reducer 追加，这里可追加一条“已重试”说明（可选）
  };
}

/** 分发 Agent：将剧本打包成 OpenClaw 客户端可读的物理发布动作 */
async function PublishNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const script = state.draftScript;
  if (!script?.scenes?.length) {
    return {
      finalActionPayload: null,
      errorLog: ['PublishNode: 无有效 draftScript'],
    };
  }

  const steps = script.scenes.map((s) => ({
    action: 'type' as const,
    text: (s as DraftScriptScene).text,
  }));

  const finalActionPayload: FinalActionPayload = {
    job_id: `job-${state.tenantId}-${Date.now()}`,
    campaign_id: `camp-${state.tenantId}`,
    action: 'RUN_SCRIPT',
    steps,
  };

  return {
    finalActionPayload,
  };
}

/** 校验节点：检查 draftScript 格式并写入 errorLog / validationPassed，供条件边使用 */
async function ValidateNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const result = validateDraftScript(state.draftScript);
  return {
    validationPassed: result.ok,
    errorLog: result.ok ? [] : [result.message ?? 'draftScript 格式不符合分镜要求'],
  };
}

/** 仅做重试计数 +1，然后由边回到 DirectorNode */
async function IncrementRetryNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  return {
    directorRetryCount: (state.directorRetryCount ?? 0) + 1,
  };
}

// ----- Step 3: 编排有向图与条件边 -----

function routeAfterValidate(state: WorkflowState): 'publish' | 'retry' | 'fail' {
  if (state.validationPassed) return 'publish';
  const retries = state.directorRetryCount ?? 0;
  if (retries >= MAX_DIRECTOR_RETRIES - 1) return 'fail'; // 已用满 3 次（0,1,2）
  return 'retry';
}

export function buildAgentWorkflowGraph() {
  const builder = new StateGraph(WorkflowStateAnnotation)
    .addNode('Scout', ScoutNode)
    .addNode('Director', DirectorNode)
    .addNode('Validate', ValidateNode)
    .addNode('IncrementRetry', IncrementRetryNode)
    .addNode('Publish', PublishNode)
    .addEdge(START, 'Scout')
    .addEdge('Scout', 'Director')
    .addEdge('Director', 'Validate')
    .addConditionalEdges('Validate', routeAfterValidate, {
      publish: 'Publish',
      retry: 'IncrementRetry',
      fail: END,
    })
    .addEdge('IncrementRetry', 'Director')
    .addEdge('Publish', END);

  return builder.compile();
}

export type CompiledAgentWorkflow = ReturnType<typeof buildAgentWorkflowGraph>;
