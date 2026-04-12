"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAgentWorkflowGraph = buildAgentWorkflowGraph;
const langgraph_1 = require("@langchain/langgraph");
const agent_workflow_types_1 = require("./agent-workflow.types");
const WorkflowStateAnnotation = langgraph_1.Annotation.Root({
    tenantId: (0, langgraph_1.Annotation)(),
    rawTaskInput: (0, langgraph_1.Annotation)(),
    competitorData: (0, langgraph_1.Annotation)(),
    draftScript: (0, langgraph_1.Annotation)(),
    errorLog: (0, langgraph_1.Annotation)({
        reducer: (left, right) => {
            const next = Array.isArray(right) ? right : [right];
            return left.concat(next);
        },
        default: () => [],
    }),
    directorRetryCount: (0, langgraph_1.Annotation)(),
    finalActionPayload: (0, langgraph_1.Annotation)(),
    validationPassed: (0, langgraph_1.Annotation)(),
});
const MIN_SCENES = 1;
const MAX_SCENES = 30;
function validateDraftScript(script) {
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
        if (typeof scene.text !== 'string') {
            return { ok: false, message: `scenes[${i}].text 须为字符串` };
        }
        const idx = scene.index;
        if (typeof idx !== 'number' || idx !== i + 1) {
            return { ok: false, message: `scenes[${i}].index 须为数字且等于 ${i + 1}` };
        }
    }
    return { ok: true };
}
async function ScoutNode(state) {
    const competitorData = {
        hooks: ['价格透明', '快速响应'],
        pain_points: ['比价繁琐', '售后不清晰'],
        summary: `基于任务「${state.rawTaskInput}」的竞品情报摘要`,
    };
    return {
        competitorData,
    };
}
async function DirectorNode(state) {
    const prevErrors = state.errorLog?.length ? state.errorLog.join('；') : '';
    const hints = prevErrors ? `\n上一轮错误（请修正）：${prevErrors}` : '';
    const draftScript = {
        template_type: '15秒故事带货',
        scenes: [
            { index: 1, text: '开头钩子：解决你的比价烦恼', type: 'hook' },
            { index: 2, text: '痛点：比价繁琐、售后不清晰', type: 'pain_point' },
            { index: 3, text: '卖点：价格透明、快速响应', type: 'cta' },
        ],
    };
    return {
        draftScript,
    };
}
async function PublishNode(state) {
    const script = state.draftScript;
    if (!script?.scenes?.length) {
        return {
            finalActionPayload: null,
            errorLog: ['PublishNode: 无有效 draftScript'],
        };
    }
    const steps = script.scenes.map((s) => ({
        action: 'type',
        text: s.text,
    }));
    const finalActionPayload = {
        job_id: `job-${state.tenantId}-${Date.now()}`,
        campaign_id: `camp-${state.tenantId}`,
        action: 'RUN_SCRIPT',
        steps,
    };
    return {
        finalActionPayload,
    };
}
async function ValidateNode(state) {
    const result = validateDraftScript(state.draftScript);
    return {
        validationPassed: result.ok,
        errorLog: result.ok ? [] : [result.message ?? 'draftScript 格式不符合分镜要求'],
    };
}
async function IncrementRetryNode(state) {
    return {
        directorRetryCount: (state.directorRetryCount ?? 0) + 1,
    };
}
function routeAfterValidate(state) {
    if (state.validationPassed)
        return 'publish';
    const retries = state.directorRetryCount ?? 0;
    if (retries >= agent_workflow_types_1.MAX_DIRECTOR_RETRIES - 1)
        return 'fail';
    return 'retry';
}
function buildAgentWorkflowGraph() {
    const builder = new langgraph_1.StateGraph(WorkflowStateAnnotation)
        .addNode('Scout', ScoutNode)
        .addNode('Director', DirectorNode)
        .addNode('Validate', ValidateNode)
        .addNode('IncrementRetry', IncrementRetryNode)
        .addNode('Publish', PublishNode)
        .addEdge(langgraph_1.START, 'Scout')
        .addEdge('Scout', 'Director')
        .addEdge('Director', 'Validate')
        .addConditionalEdges('Validate', routeAfterValidate, {
        publish: 'Publish',
        retry: 'IncrementRetry',
        fail: langgraph_1.END,
    })
        .addEdge('IncrementRetry', 'Director')
        .addEdge('Publish', langgraph_1.END);
    return builder.compile();
}
//# sourceMappingURL=agent-workflow.graph.js.map