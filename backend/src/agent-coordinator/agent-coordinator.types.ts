/**
 * 智能体调度引擎 —— LLM Function Calling / MCP 工具格式
 * 与 OpenAI / DeepSeek tools 数组兼容
 */

export type LLMFunctionJsonSchema = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  description?: string;
  format?: string;
  enum?: unknown[];
  default?: unknown;
  examples?: unknown[];
  properties?: Record<string, LLMFunctionJsonSchema>;
  required?: string[];
  items?: LLMFunctionJsonSchema;
  additionalProperties?: boolean | LLMFunctionJsonSchema;
  oneOf?: LLMFunctionJsonSchema[];
  anyOf?: LLMFunctionJsonSchema[];
  allOf?: LLMFunctionJsonSchema[];
};

/** 单条 function tool 定义（OpenAI/DeepSeek 兼容） */
export interface LLMFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: LLMFunctionJsonSchema & { type: 'object' };
  };
}

/** 注入到 LLM 上下文前的工具列表 */
export type LLMToolsInput = LLMFunctionTool[];
