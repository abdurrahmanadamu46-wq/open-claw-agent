/**
 * OpenClaw 边缘节点 — 自定义指令沙盒约束接口
 * 允许高阶客户上传 JS 片段，在节点上执行平台未原生支持的特殊抓取/点击逻辑；
 * 实现方必须保证：超时、无 require('fs')/child_process、仅注入规定上下文（如 page）。
 */

/** 注入到自定义脚本的只读上下文（由节点提供） */
export interface CustomScriptContext {
  /** Playwright Page 实例的句柄或代理，脚本内可调用 page.click / page.fill 等 */
  page?: unknown;
  /** 当前任务 job_id */
  jobId?: string;
  /** 当前 campaign_id */
  campaignId?: string;
  /** 当前 URL（若在浏览器上下文中） */
  url?: string;
  /** 只读参数，来自 steps[].context */
  params?: Record<string, unknown>;
}

/** 脚本执行结果，返回给调度端 */
export interface CustomScriptResult {
  ok: boolean;
  /** 返回值（可序列化部分，如截图路径、抓取到的文本） */
  value?: unknown;
  /** 错误信息（若 ok 为 false） */
  error?: string;
  /** 实际耗时 ms */
  durationMs?: number;
}

/**
 * 自定义脚本执行器 — 安全沙盒机制
 * 节点实现时建议：vm2 / isolated-vm / 子进程 + 超时，禁止 require('child_process')、require('fs') 等
 */
export interface CustomScriptRunner {
  /**
   * 在沙盒内执行客户提供的脚本
   * @param script 客户上传的 JS 代码（可为 async 函数体或 IIFE）
   * @param context 注入的只读上下文（如 page、jobId、params）
   * @param timeoutMs 超时毫秒
   */
  run(
    script: string,
    context: CustomScriptContext,
    timeoutMs?: number,
  ): Promise<CustomScriptResult>;
}
