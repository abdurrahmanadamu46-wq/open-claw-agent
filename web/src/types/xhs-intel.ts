export interface XhsCompetitiveNoteAuthor {
  userId?: string;
  nickname?: string;
  profileUrl?: string;
}

export interface XhsCompetitiveNoteMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}

export interface XhsCompetitiveNoteSample {
  source: {
    platform?: 'xiaohongshu' | string;
    noteId?: string;
    noteUrl?: string;
    postUrl?: string;
    capturedAt?: string;
  };
  author?: XhsCompetitiveNoteAuthor;
  note: {
    title?: string;
    content?: string;
    publishedAt?: string;
    tags?: string[];
    metrics?: XhsCompetitiveNoteMetrics;
  };
  comments?: string[];
  classification?: {
    industry?: string;
    niche?: string;
    scenario?: string;
  };
}

export interface XhsCompetitiveIngestResponse {
  code: number;
  data: {
    inserted: boolean;
    corpusId?: string;
    formula: {
      title?: string;
      category?: string;
      [key: string]: unknown;
    };
    profileUpdatedAt: string;
    sourcePlatform: 'xiaohongshu';
  };
}

export interface XhsCompetitivePreviewSample {
  title?: string;
  transcript?: string;
  comments?: string[];
}

export interface XhsCompetitiveIntelRequestPayload extends XhsCompetitiveNoteSample {
  sample?: XhsCompetitivePreviewSample;
  targetAgents?: string[];
  upsertAsCorpus?: boolean;
}

export interface XhsCompetitivePreviewResponse {
  code: number;
  data: {
    source_platform: 'xiaohongshu';
    note: {
      title?: string;
      content?: string;
      transcript?: string;
      [key: string]: unknown;
    };
    comments: Array<{
      content?: string;
      [key: string]: unknown;
    }>;
    competitive_intel_request: XhsCompetitiveIntelRequestPayload;
  };
}
