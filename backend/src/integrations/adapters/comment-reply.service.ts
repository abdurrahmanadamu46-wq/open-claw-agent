/**
 * 外接知识库客服 — 对接 Coze / FastGPT 等自动回复评论
 */

import type { TenantIntegrationsAiCustomerService } from '../tenant-integrations.types';

export interface CommentReplyResult {
  replyText: string;
  /** 可选：命中的知识库来源 */
  source?: string;
}

/**
 * 评论自动回复服务接口：根据评论内容 + 租户配置的 bot 生成回复
 */
export interface CommentReplyService {
  readonly name: string;

  /**
   * 使用 Coze（或配置的 provider）知识库 Bot 根据评论内容生成回复
   * @param commentText 用户评论原文
   * @param config 租户的 ai_customer_service 配置（含 apiToken、botId）
   */
  generateReply(config: TenantIntegrationsAiCustomerService, commentText: string): Promise<CommentReplyResult>;

  /**
   * 便捷方法：仅传 botId 时从某处解析 config（可由调用方注入 tenant 配置）
   */
  generateReplyWithCoze?(commentText: string, botId: string, apiToken: string): Promise<CommentReplyResult>;
}

/**
 * 空壳实现：不调用真实 Coze/FastGPT API，生产替换为对应 SDK 或 HTTP 调用
 */
export class CommentReplyServiceStub implements CommentReplyService {
  readonly name = 'comment-reply-service-stub';

  async generateReply(
    _config: TenantIntegrationsAiCustomerService,
    commentText: string,
  ): Promise<CommentReplyResult> {
    return {
      replyText: `[Stub] 已收到评论：「${commentText.slice(0, 50)}…」，请配置 Coze/FastGPT 后使用真实回复`,
      source: 'stub',
    };
  }

  async generateReplyWithCoze(
    commentText: string,
    _botId: string,
    _apiToken: string,
  ): Promise<CommentReplyResult> {
    return this.generateReply(
      { provider: 'coze', apiToken: _apiToken, botId: _botId },
      commentText,
    );
  }
}
