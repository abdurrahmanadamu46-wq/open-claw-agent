/**
 * Behavior Runtime — 行为解释器
 * 解析 BehaviorPath，按步骤产出「可执行指令」或驱动延迟执行（用于服务端模拟/测试）。
 * 边缘端可消费同一套 steps，用 Timing Controller + RPA Adapter 执行。
 */
import { Injectable } from '@nestjs/common';
import type { BehaviorPath, BehaviorStep, BehaviorAction } from './types/behavior.types';

/** 单步执行结果（边缘可上报） */
export interface StepResult {
  stepIndex: number;
  action: BehaviorAction;
  startedAt: string;
  completedAt?: string;
  success: boolean;
  error?: string;
}

/** 噪声：在 delay 上乘以 (1 + noiseFactor * (rnd - 0.5)) */
const NOISE_FACTOR = 0.2;

function addNoise(value: number, rnd: () => number): number {
  return Math.max(0.1, value * (1 + NOISE_FACTOR * (rnd() - 0.5)));
}

@Injectable()
export class BehaviorRuntimeService {
  /**
   * 将行为路径解析为「带随机化 delay 的步骤序列」，供边缘按序执行。
   * 不实际 sleep，只返回应执行的 delay(ms) 与 action。
   */
  interpret(path: BehaviorPath, rnd: () => number = Math.random): { action: BehaviorStep['action']; delayMs: number; durationSec?: number; target?: string; content?: string }[] {
    return path.steps.map((step) => {
      const delaySec = step.delay ?? 0.5;
      const delayMs = Math.round(addNoise(delaySec * 1000, rnd));
      return {
        action: step.action,
        delayMs,
        durationSec: step.duration,
        target: step.target,
        content: step.content,
      };
    });
  }

  /**
   * 同步执行路径（仅用于测试）：按 steps 顺序，模拟 delay 后返回每步结果。
   * 实际边缘端应使用 interpret() 得到的序列，在真实环境中执行 RPA。
   */
  async runPath(path: BehaviorPath, opts?: { noise?: boolean }): Promise<StepResult[]> {
    const rnd = opts?.noise !== false ? Math.random : () => 0.5;
    const steps = this.interpret(path, rnd);
    const results: StepResult[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const startedAt = new Date().toISOString();
      await new Promise((r) => setTimeout(r, step.delayMs));
      results.push({
        stepIndex: i,
        action: step.action,
        startedAt,
        completedAt: new Date().toISOString(),
        success: true,
      });
    }
    return results;
  }
}
