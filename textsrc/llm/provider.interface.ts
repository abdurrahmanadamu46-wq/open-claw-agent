/**
 * ClawCommerce LLM 抽象层 — 统一大模型调用接口
 * 所有业务代码仅依赖此接口，切换模型只需 env 配置，零业务改动。
 */

/** 单条消息 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 普通对话选项 */
export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

/** 结构化输出选项（在 Prompt 中引导 + 可选 response_format） */
export interface StructuredJsonOptions extends ChatOptions {
  /** 若 provider 支持，会使用 API 的 response_format / json_schema */
  useNativeSchema?: boolean;
}

/**
 * 大模型提供方抽象接口
 * 实现方：DeepSeek / OpenAI / Claude / Grok 等 Adapter
 */
export interface LLMProvider {
  /** 提供商标识，用于日志与配置 */
  readonly name: string;

  /**
   * 普通对话补全
   * @param messages 对话历史
   * @param options 温度、maxTokens 等
   * @returns 助手回复纯文本
   */
  chat(messages: LLMMessage[], options?: ChatOptions): Promise<string>;

  /**
   * 强制结构化 JSON 输出
   * 内部会：1）在 system/user 中注入 schema 说明；2）若 API 支持则使用 response_format；3）解析并校验 JSON
   * @param messages 对话历史（可含 system 引导）
   * @param schema JSON Schema 对象，用于引导生成格式
   * @param options 同 chat + useNativeSchema
   * @returns 解析后的 T，保证可安全 parse
   */
  structuredJson<T = unknown>(
    messages: LLMMessage[],
    schema: Record<string, unknown>,
    options?: StructuredJsonOptions
  ): Promise<T>;
}
