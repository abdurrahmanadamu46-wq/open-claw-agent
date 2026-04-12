export interface RadarSniffingJobPayload {
    tenantId: string;
    competitorUrl: string;
    industryKeywords: string[];
    jobId: string;
}
export interface ContentForgeJobPayload {
    tenantId: string;
    viralText: string;
    sourceUrl?: string;
    jobId: string;
}
export interface MatrixDispatchJobPayload {
    tenantId: string;
    videoUrl: string;
    script: string;
    nodeIds: string[];
    scheduledAt?: string;
    jobId: string;
}
export interface LeadHarvestJobPayload {
    tenantId: string;
    campaignId: string;
    publishedAt: string;
    jobId: string;
}
