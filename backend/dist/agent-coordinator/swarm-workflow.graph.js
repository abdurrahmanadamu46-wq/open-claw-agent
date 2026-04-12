"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSwarmWorkflowGraph = buildSwarmWorkflowGraph;
const langgraph_1 = require("@langchain/langgraph");
const SwarmStateAnnotation = langgraph_1.Annotation.Root({
    messages: (0, langgraph_1.Annotation)({
        reducer: (left, right) => {
            const next = Array.isArray(right) ? right : [right];
            return (left ?? []).concat(next);
        },
        default: () => [],
    }),
    current_agent: (0, langgraph_1.Annotation)(),
    video_draft: (0, langgraph_1.Annotation)(),
    audit_passed: (0, langgraph_1.Annotation)(),
});
const NODE_VIRAL = 'ViralEngine';
const NODE_WRITER = 'GoldenWriter';
const NODE_AUDITOR = 'RiskAuditor';
async function ViralEngineNode(state) {
    const lastUser = state.messages?.filter((m) => m.role === 'user').pop()?.content ?? '';
    const summary = `[爆款拆解] 基于输入「${lastUser.slice(0, 80)}...」的爆款要素与结构已提取`;
    return {
        current_agent: NODE_VIRAL,
        messages: [
            ...(state.messages ?? []),
            { role: 'assistant', content: summary },
        ],
    };
}
async function GoldenWriterNode(state) {
    const draft = {
        template_type: '15秒故事带货',
        scenes: [
            { index: 1, text: '开头钩子：抓住注意力', type: 'hook' },
            { index: 2, text: '痛点与卖点', type: 'body' },
            { index: 3, text: '行动号召', type: 'cta' },
        ],
    };
    const reason = state.video_draft?.rejection_reason;
    if (reason) {
        draft.scenes[0].text += ` [重写说明：${reason}]`;
    }
    return {
        current_agent: NODE_WRITER,
        video_draft: draft,
    };
}
async function RiskAuditorNode(state) {
    const draft = state.video_draft;
    const hasViolation = draft?.scenes?.some((s) => /违禁|极限|绝对/.test(s.text)) ?? false;
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
function routeAfterAudit(state) {
    return state.audit_passed ? 'end' : 'rewrite';
}
function buildSwarmWorkflowGraph() {
    const builder = new langgraph_1.StateGraph(SwarmStateAnnotation)
        .addNode(NODE_VIRAL, ViralEngineNode)
        .addNode(NODE_WRITER, GoldenWriterNode)
        .addNode(NODE_AUDITOR, RiskAuditorNode)
        .addEdge(langgraph_1.START, NODE_VIRAL)
        .addEdge(NODE_VIRAL, NODE_WRITER)
        .addEdge(NODE_WRITER, NODE_AUDITOR)
        .addConditionalEdges(NODE_AUDITOR, routeAfterAudit, {
        rewrite: NODE_WRITER,
        end: langgraph_1.END,
    });
    return builder.compile();
}
//# sourceMappingURL=swarm-workflow.graph.js.map