"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommentReplyServiceStub = void 0;
class CommentReplyServiceStub {
    constructor() {
        this.name = 'comment-reply-service-stub';
    }
    async generateReply(_config, commentText) {
        return {
            replyText: `[Stub] 已收到评论：「${commentText.slice(0, 50)}…」，请配置 Coze/FastGPT 后使用真实回复`,
            source: 'stub',
        };
    }
    async generateReplyWithCoze(commentText, _botId, _apiToken) {
        return this.generateReply({ provider: 'coze', apiToken: _apiToken, botId: _botId }, commentText);
    }
}
exports.CommentReplyServiceStub = CommentReplyServiceStub;
//# sourceMappingURL=comment-reply.service.js.map