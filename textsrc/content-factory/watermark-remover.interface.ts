/**
 * AI 内容工厂 — 去水印抽象接口
 * 生成的视频/图片可能带「AI 生成」等水印；合规场景下可选用去水印步骤，产出无水印版本
 */

export interface WatermarkRemoveResult {
  /** 去水印后的资源 URL 或本地路径 */
  outputUrl: string;
}

/**
 * 去水印提供方抽象接口
 * 实现方：自研算法 / 第三方 API / 模板裁剪等
 */
export interface WatermarkRemoverProvider {
  readonly name: string;

  /**
   * 去除视频或图片上的 AI 生成水印
   * @param inputUrl 带水印的 MP4/图片 URL（公网可访问）或本地路径
   * @returns 无水印资源的 URL 或路径
   */
  remove(inputUrl: string): Promise<WatermarkRemoveResult>;
}
