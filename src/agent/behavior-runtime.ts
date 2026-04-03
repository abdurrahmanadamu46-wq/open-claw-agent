/**
 * Behavior Runtime — 边缘端行为解释器
 * 解析云端下发的 BehaviorPath，按步骤执行：delay → execute（由调用方注入 RPA）。
 * 与 backend 的 BehaviorPath 契约一致，可与 /behavior/interpret 对齐。
 */

export type BehaviorAction =
  | 'open_app'
  | 'scroll_feed'
  | 'pause'
  | 'click'
  | 'scroll'
  | 'like'
  | 'comment'
  | 'share'
  | 'follow'
  | 'exit';

export interface BehaviorStep {
  action: BehaviorAction;
  delay?: number;
  duration?: number;
  target?: string;
  content?: string;
}

export interface BehaviorPath {
  session_id: string;
  steps: BehaviorStep[];
}

export interface InterpretedStep {
  action: BehaviorAction;
  delayMs: number;
  durationSec?: number;
  target?: string;
  content?: string;
}

const NOISE = 0.2;
function addNoise(sec: number): number {
  const ms = sec * 1000;
  return Math.round(ms * (1 + NOISE * (Math.random() - 0.5)));
}

/**
 * 将行为路径解析为带随机化 delay 的步骤序列（与 backend BehaviorRuntimeService.interpret 一致）
 */
export function interpret(path: BehaviorPath): InterpretedStep[] {
  const defaults: Record<BehaviorAction, number> = {
    open_app: 2,
    scroll_feed: 0.5,
    pause: 0.3,
    click: 1,
    scroll: 0.2,
    like: 0.8,
    comment: 1,
    share: 1,
    follow: 1,
    exit: 1.5,
  };
  return path.steps.map((step) => {
    const delaySec = step.delay ?? defaults[step.action] ?? 0.5;
    return {
      action: step.action,
      delayMs: Math.max(100, addNoise(delaySec)),
      durationSec: step.duration,
      target: step.target,
      content: step.content,
    };
  });
}

/**
 * 按序执行路径：每步先 delay 再调用 executor。
 * @param path 行为路径
 * @param executor 单步执行器（如调用 RPA：open_app → 打开 App，like → 点赞等）
 */
export async function runPath(
  path: BehaviorPath,
  executor: (step: InterpretedStep, index: number) => Promise<void>,
): Promise<void> {
  const steps = interpret(path);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    await new Promise((r) => setTimeout(r, step.delayMs));
    await executor(step, i);
  }
}
