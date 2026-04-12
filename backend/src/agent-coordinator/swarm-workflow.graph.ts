/**
 * LangGraph Swarm 蜂群状态机
 * 三位元老：爆款拆解引擎 → 黄金前三秒编剧 → 风控审核员
 * 动态路由：审核员若发现违规，不抛异常，将状态路由回编剧节点要求重写；通过则结束
 */

import { Annotation, START, END, StateGraph } from '@langchain/langgraph';
import type { SwarmMessage, VideoDraft } from './swarm-workflow.types';

// ----- 状态定义 -----

const SwarmStateAnnotation = Annotation.Root({
  messages: Annotation<SwarmMessage[]>({
    reducer: (left, right) => {
      const next = Array.isArray(right) ? right : [right as SwarmMessage];
      return (left ?? []).concat(next);
    },
    default: () => [],
  }),
  current_agent: Annotation<string>(),
  video_draft: Annotation<VideoDraft | null>(),
  /** 审核是否通过；供条件边使用 */
  audit_passed: Annotation<boolean>(),
});

export type SwarmWorkflowState = typeof SwarmStateAnnotation.State;

// ----- 三位元老节点 -----

const NODE_VIRAL = 'ViralEngine';   // 爆款拆解引擎
const NODE_WRITER = 'GoldenWriter'; // 黄金前三秒编剧
const NODE_AUDITOR = 'RiskAuditor'; // 风控审核员

/** 爆款拆解引擎：产出竞品/爆款结构化情报，供编剧使用 */
async function ViralEngineNode(state: SwarmWorkflowState): Promise<Partial<SwarmWorkflowState>> {
  const lastUser = state.messages?.filter((m) => m.role === 'user').pop()?.content ?? '';
  // 占位：实际可调 LLM 或爆款拆解服务
  const summary = `[爆款拆解] 基于输入「${lastUser.slice(0, 80)}...」的爆款要素与结构已提取`;
  return {
    current_agent: NODE_VIRAL,
    messages: [
      ...(state.messages ?? []),
      { role: 'assistant' as const, content: summary },
    ],
  };
}

/** 黄金前三秒编剧：根据爆款情报生成视频脚本草稿 */
async function GoldenWriterNode(state: SwarmWorkflowState): Promise<Partial<SwarmWorkflowState>> {
  const draft: VideoDraft = {
    template_type: '15秒故事带货',
    scenes: [
      { index: 1, text: '开头钩子：抓住注意力', type: 'hook' },
      { index: 2, text: '痛点与卖点', type: 'body' },
      { index: 3, text: '行动号召', type: 'cta' },
    ],
  };
  // 若从审核员打回，可读取 state.video_draft?.rejection_reason 作为重写指引
  const reason = state.video_draft?.rejection_reason;
  if (reason) {
    draft.scenes[0].text += ` [重写说明：${reason}]`;
  }
  return {
    current_agent: NODE_WRITER,
    video_draft: draft,
  };
}

/** 风控审核员：检查 video_draft 是否违规，不抛异常，通过 state 打回或放行 */
async function RiskAuditorNode(state: SwarmWorkflowState): Promise<Partial<SwarmWorkflowState>> {
  const draft = state.video_draft;
  // 占位：实际可调风控规则或 LLM 做合规判断
  const hasViolation = draft?.scenes?.some(
    (s) => /违禁|极限|绝对/.test(s.text),
  ) ?? false;
  if (hasViolation) {
    return {
      current_agent: NODE_AUDITOR,
      audit_passed: false,
      video_draft: draft ? { ...draft, rejection_reason: '检测到疑似违禁/极限词，请软化表述' } : null,
    };
  }
  return {
    current_agent: NODE_AUDITOR,
    audit_passed: true,
  };
}

// ----- 条件边：审核后路由 -----

function routeAfterAudit(state: SwarmWorkflowState): 'rewrite' | 'end' {
  return state.audit_passed ? 'end' : 'rewrite';
}

// ----- 编译图 -----

export function buildSwarmWorkflowGraph() {
  const builder = new StateGraph(SwarmStateAnnotation)
    .addNode(NODE_VIRAL, ViralEngineNode)
    .addNode(NODE_WRITER, GoldenWriterNode)
    .addNode(NODE_AUDITOR, RiskAuditorNode)
    .addEdge(START, NODE_VIRAL)
    .addEdge(NODE_VIRAL, NODE_WRITER)
    .addEdge(NODE_WRITER, NODE_AUDITOR)
    .addConditionalEdges(NODE_AUDITOR, routeAfterAudit, {
      rewrite: NODE_WRITER, // 打回编剧重写
      end: END,
    });

  return builder.compile();
}

export type CompiledSwarmWorkflow = ReturnType<typeof buildSwarmWorkflowGraph>;
