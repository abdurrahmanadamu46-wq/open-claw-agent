/**
 * 智能体调度引擎 — LLM Function Calling / MCP 工具格式
 * 与 OpenAI / DeepSeek tools 数组兼容
 */

/** 单条 function tool 定义（OpenAI/DeepSeek 兼容） */
export interface LLMFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties?: Record<string, { type: string; description?: string; enum?: string[] | number[] }>;
      required?: string[];
    };
  };
}

/** 注入到 LLM 上下文前的工具列表 */
export type LLMToolsInput = LLMFunctionTool[];
