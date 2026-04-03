/**
 * 龙虾底座 — 打码平台抽象接口
 * 可插拔：任意第三方打码（2Captcha、Anti-Captcha、图鉴等）
 */

export interface CaptchaSolveOptions {
  /** 类型：image / click / slider 等 */
  type?: 'image' | 'click' | 'slider' | 'recaptcha_v2' | 'recaptcha_v3';
  /** 超时（毫秒） */
  timeoutMs?: number;
}

export interface CaptchaSolveResult {
  /** 识别结果文本或坐标 JSON */
  text: string;
  /** 可选：打码平台任务 ID */
  taskId?: string;
}

/**
 * 打码平台提供方抽象接口
 * 实现方：2Captcha、Anti-Captcha、图鉴、自建等
 */
export interface CaptchaSolverProvider {
  readonly name: string;

  /**
   * 提交打码任务并等待结果
   * @param imageInput 图片 URL（公网可访问）或 Base64 字符串
   * @param options 类型、超时等
   * @returns 识别结果
   */
  solve(imageInput: string, options?: CaptchaSolveOptions): Promise<CaptchaSolveResult>;
}
