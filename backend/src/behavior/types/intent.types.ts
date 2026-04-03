/**
 * Intent Engine — 动机/意图数据结构
 * 决定「为什么做这个行为」，输出动作偏好而非单点指令。
 * 设计见：docs/行为操作系统_设计蓝图_合规边界内.md
 */

export interface ActionBias {
  like?: number;
  comment?: number;
  follow?: number;
  share?: number;
}

export interface IntentOutput {
  intent: string;
  confidence: number;
  action_bias: ActionBias;
}
