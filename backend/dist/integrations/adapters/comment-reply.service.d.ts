import type { TenantIntegrationsAiCustomerService } from '../tenant-integrations.types';
export interface CommentReplyResult {
    replyText: string;
    source?: string;
}
export interface CommentReplyService {
    readonly name: string;
    generateReply(config: TenantIntegrationsAiCustomerService, commentText: string): Promise<CommentReplyResult>;
    generateReplyWithCoze?(commentText: string, botId: string, apiToken: string): Promise<CommentReplyResult>;
}
export declare class CommentReplyServiceStub implements CommentReplyService {
    readonly name = "comment-reply-service-stub";
    generateReply(_config: TenantIntegrationsAiCustomerService, commentText: string): Promise<CommentReplyResult>;
    generateReplyWithCoze(commentText: string, _botId: string, _apiToken: string): Promise<CommentReplyResult>;
}
