/**
 * 雷达大脑 — ASR（语音转文字）抽象接口
 * 可插拔：阿里听悟 / Whisper API / 通义听悟 等，业务只依赖本接口。
 */

/** 输入：URL（可公网访问的音频/视频）或本地路径 */
export type ASRInput = string;

export interface ASROptions {
  /** 语言，如 zh-CN、en */
  language?: string;
  /** 若为视频 URL，是否只转前 N 秒（省时省费） */
  maxDurationSeconds?: number;
}

/**
 * ASR 提供方抽象接口
 * 实现方：阿里听悟、Whisper API、通义听悟等
 */
export interface ASRProvider {
  readonly name: string;

  /**
   * 语音/视频转文字
   * @param input 音频/视频 URL（公网可访问）或本地文件路径
   * @param options 语言、时长限制等
   * @returns 全文转录结果
   */
  transcribe(input: ASRInput, options?: ASROptions): Promise<string>;
}
