"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentCoordinatorService = void 0;
const common_1 = require("@nestjs/common");
const agent_workflow_graph_1 = require("./agent-workflow.graph");
const integrations_service_1 = require("../integrations/integrations.service");
let AgentCoordinatorService = class AgentCoordinatorService {
    constructor(integrationsService) {
        this.integrationsService = integrationsService;
        this.workflowGraph = (0, agent_workflow_graph_1.buildAgentWorkflowGraph)();
    }
    async runAgentWorkflow(tenantId, rawTaskInput) {
        const result = await this.workflowGraph.invoke({
            tenantId,
            rawTaskInput,
            competitorData: null,
            draftScript: null,
            errorLog: [],
            directorRetryCount: 0,
            finalActionPayload: null,
            validationPassed: false,
        });
        return {
            finalActionPayload: result.finalActionPayload ?? null,
            errorLog: result.errorLog ?? [],
        };
    }
    async injectUserToolsIntoContext(tenantId) {
        const integrations = await this.integrationsService.getIntegrations(tenantId);
        const customTools = integrations.custom_tools;
        if (!customTools)
            return [];
        const tools = [];
        for (const mcp of customTools.mcpServers ?? []) {
            if (!mcp.name || !mcp.url)
                continue;
            tools.push({
                type: 'function',
                function: {
                    name: `mcp_${mcp.name.replace(/\W/g, '_')}`,
                    description: `调用 MCP 服务器「${mcp.name}」(${mcp.url})，可查询或执行该服务提供的工具与数据。`,
                    parameters: {
                        type: 'object',
                        properties: {
                            method: { type: 'string', description: 'MCP 方法名' },
                            params: { type: 'object', description: '方法参数' },
                        },
                    },
                },
            });
        }
        for (const api of customTools.customApis ?? []) {
            if (!api.name || !api.endpoint)
                continue;
            const raw = api.schema && typeof api.schema === 'object' ? api.schema : {};
            const properties = (raw.properties && typeof raw.properties === 'object'
                ? Object.fromEntries(Object.entries(raw.properties).map(([k, v]) => [
                    k,
                    typeof v === 'object' && v && 'type' in v
                        ? { type: String(v.type ?? 'string'), description: v.description }
                        : { type: 'string' },
                ]))
                : {});
            tools.push({
                type: 'function',
                function: {
                    name: `api_${api.name.replace(/\W/g, '_')}`,
                    description: api.description || `调用自定义 API：${api.endpoint}（${api.method}）`,
                    parameters: { type: 'object', properties, required: raw.required },
                },
            });
        }
        return tools;
    }
};
exports.AgentCoordinatorService = AgentCoordinatorService;
exports.AgentCoordinatorService = AgentCoordinatorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [integrations_service_1.IntegrationsService])
], AgentCoordinatorService);
//# sourceMappingURL=agent-coordinator.service.js.map