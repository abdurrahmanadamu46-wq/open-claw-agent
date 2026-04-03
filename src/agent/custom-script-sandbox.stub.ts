/**
 * 自定义脚本沙盒 — 空壳实现（占位）
 * 生产实现：使用 vm2 或 isolated-vm 注入 { page, jobId, params }，执行 script 并捕获返回值；
 * 必须设置 timeoutMs、禁止访问 process/require('fs') 等
 */

import type { CustomScriptContext, CustomScriptResult, CustomScriptRunner } from './custom-script-sandbox.types.js';

export class CustomScriptSandboxStub implements CustomScriptRunner {
  async run(
    script: string,
    _context: CustomScriptContext,
    timeoutMs?: number,
  ): Promise<CustomScriptResult> {
    const start = Date.now();
    // 占位：不执行真实代码，避免任意代码执行
    if (script.includes('require(') || script.includes('process.') || script.includes('child_process')) {
      return {
        ok: false,
        error: 'Sandbox: 禁止使用 require/process/child_process',
        durationMs: Date.now() - start,
      };
    }
    return {
      ok: true,
      value: { stub: true, message: '自定义脚本沙盒未接入，请在节点实现 CustomScriptRunner' },
      durationMs: Date.now() - start,
    };
  }
}
