import { Injectable } from '@nestjs/common';
import { buildAgentWorkflowGraph } from './agent-workflow.graph';
import type { FinalActionPayload } from './agent-workflow.types';
import { IntegrationsService } from '../integrations/integrations.service';
import type { LLMFunctionTool, LLMToolsInput } from './agent-coordinator.types';

/**
 * 智能体调度引擎 — LangGraph 多脑协同 + 动态工具箱 (Tool Registry)
 * - runAgentWorkflow: 基于状态图执行 Scout -> Director -> Publish，含自我纠错（Director 最多重试 3 次）
 * - injectUserToolsIntoContext: 将租户 MCP/自定义 API 转化为 LLM tools 数组
 */
@Injectable()
export class AgentCoordinatorService {
  private workflowGraph = buildAgentWorkflowGraph();

  constructor(private readonly integrationsService: IntegrationsService) {}

  /**
   * 执行多智能体工作流：侦察 -> 编导（含格式校验与重试）-> 分发
   * @returns 最终下发给客户端的 payload，或 null（校验多次失败时）
   */
  async runAgentWorkflow(
    tenantId: string,
    rawTaskInput: string,
  ): Promise<{ finalActionPayload: FinalActionPayload | null; errorLog: string[] }> {
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

  /**
   * 根据租户 ID 从数据库/Redis 读取 MCP 与自定义 API，转化为标准 tools 数组，
   * 供 LLM 请求时注入（如 chat.completions 的 tools 参数）
   */
  async injectUserToolsIntoContext(tenantId: string): Promise<LLMToolsInput> {
    const integrations = await this.integrationsService.getIntegrations(tenantId);
    const customTools = integrations.custom_tools;
    if (!customTools) return [];

    const tools: LLMFunctionTool[] = [];

    // MCP 服务器：每个暴露为一个可调用的 tool，LLM 可请求代理到对应 MCP
    for (const mcp of customTools.mcpServers ?? []) {
      if (!mcp.name || !mcp.url) continue;
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

    // 自定义 API：按 OpenAPI schema 转成 function
    for (const api of customTools.customApis ?? []) {
      if (!api.name || !api.endpoint) continue;
      const raw = api.schema && typeof api.schema === 'object' ? api.schema as { properties?: Record<string, unknown>; required?: string[] } : {};
      const properties = (raw.properties && typeof raw.properties === 'object'
        ? Object.fromEntries(
            Object.entries(raw.properties).map(([k, v]) => [
              k,
              typeof v === 'object' && v && 'type' in v
                ? { type: String((v as { type?: string }).type ?? 'string'), description: (v as { description?: string }).description }
                : { type: 'string' as const },
            ])
          )
        : {}) as Record<string, { type: string; description?: string }>;
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
}
