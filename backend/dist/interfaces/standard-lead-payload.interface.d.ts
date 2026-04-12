export type LeadSourcePlatform = 'douyin' | 'xiaohongshu' | 'kuaishou';
export interface LeadDetails {
    username: string;
    profileUrl: string;
    content: string;
    sourceVideoUrl: string;
}
export interface StandardLeadPayload {
    eventId: string;
    timestamp: string;
    tenantId: string;
    source: LeadSourcePlatform;
    leadDetails: LeadDetails;
}
