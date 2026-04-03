import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  CompetitivePlatform,
  RagCompetitiveFormulaRecord,
  RagCompetitiveSampleMetrics,
} from './tenant-profiles.types';

export interface CompetitiveIntelAnalyzeRequest {
  source: {
    platform: CompetitivePlatform | string;
    accountId?: string;
    accountName?: string;
    profileUrl?: string;
    postUrl?: string;
    capturedAt?: string;
  };
  classification?: {
    industry?: string;
    niche?: string;
    scenario?: string;
  };
  sample: {
    title?: string;
    hook?: string;
    transcript?: string;
    cta?: string;
    comments?: string[];
    metrics?: RagCompetitiveSampleMetrics;
  };
}

export interface CompetitiveIntelAnalyzeResult {
  formula: RagCompetitiveFormulaRecord;
  recommendedAgentIds: string[];
}

const DEFAULT_RECOMMENDED_AGENTS = ['radar', 'strategist', 'inkwriter', 'visualizer', 'dispatcher'];

@Injectable()
export class RagCompetitiveIntelService {
  analyze(payload: CompetitiveIntelAnalyzeRequest): CompetitiveIntelAnalyzeResult {
    const source = payload.source ?? { platform: 'other' };
    const sample = payload.sample ?? {};
    const title = this.cleanText(sample.title) || 'untitled-competitive-sample';
    const transcript = this.cleanText(sample.transcript);
    const hook = this.cleanText(sample.hook) || this.deriveHook(title, transcript);
    const cta = this.cleanText(sample.cta);
    const platform = this.normalizePlatform(source.platform);
    const accountId = this.cleanText(source.accountId);
    const accountName = this.cleanText(source.accountName);

    const category = this.deriveCategory([title, hook, transcript].join(' '));
    const narrativeStructure = this.deriveNarrativeStructure({ hook, transcript, cta });
    const emotionalTriggers = this.deriveEmotionalTriggers([title, hook, transcript].join(' '));
    const proofPoints = this.deriveProofPoints({
      title,
      transcript,
      metrics: sample.metrics,
      comments: sample.comments ?? [],
    });
    const antiRiskNotes = this.deriveAntiRiskNotes(platform);
    const confidence = this.deriveConfidence({
      transcript,
      metrics: sample.metrics,
      commentCount: sample.comments?.length ?? 0,
    });

    const fingerprint = this.buildFingerprint({
      platform,
      accountId,
      title,
      hook,
      transcript,
    });
    const extractedAt = new Date().toISOString();
    const formulaId = `formula_${extractedAt.slice(0, 10).replace(/-/g, '')}_${fingerprint.slice(0, 8)}`;

    const tags = this.composeTags({
      platform,
      category,
      industry: payload.classification?.industry,
      niche: payload.classification?.niche,
      scenario: payload.classification?.scenario,
      emotionalTriggers,
    });

    const metrics = this.normalizeMetrics(sample.metrics);

    const formula: RagCompetitiveFormulaRecord = {
      id: formulaId,
      fingerprint,
      category,
      industry: this.cleanText(payload.classification?.industry),
      niche: this.cleanText(payload.classification?.niche),
      scenario: this.cleanText(payload.classification?.scenario),
      source: {
        platform,
        accountId: accountId || undefined,
        accountName: accountName || undefined,
        profileUrl: this.cleanText(source.profileUrl) || undefined,
        postUrl: this.cleanText(source.postUrl) || undefined,
        capturedAt: this.cleanText(source.capturedAt) || extractedAt,
      },
      title,
      hook,
      narrativeStructure,
      ctaPattern: cta || this.deriveCtaPattern(transcript),
      emotionalTriggers,
      proofPoints,
      antiRiskNotes,
      tags,
      metrics,
      senateInsights: {
        radar: this.buildRadarInsight({ platform, accountName, accountId, metrics }),
        strategist: this.buildStrategistInsight({ category, emotionalTriggers, proofPoints }),
        inkwriter: this.buildInkwriterInsight({ hook, narrativeStructure, cta }),
        visualizer: this.buildVisualizerInsight({ narrativeStructure, emotionalTriggers }),
        dispatcher: this.buildDispatcherInsight({ platform, category, confidence }),
      },
      confidence,
      extractedAt,
    };

    return {
      formula,
      recommendedAgentIds: DEFAULT_RECOMMENDED_AGENTS,
    };
  }

  private cleanText(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\s+/g, ' ');
  }

  private normalizePlatform(value: unknown): CompetitivePlatform {
    const normalized = this.cleanText(value).toLowerCase();
    if (
      normalized === 'douyin' ||
      normalized === 'xiaohongshu' ||
      normalized === 'kuaishou' ||
      normalized === 'bilibili' ||
      normalized === 'wechat'
    ) {
      return normalized;
    }
    return 'other';
  }

  private deriveHook(title: string, transcript: string): string {
    const firstSentence = transcript
      .split(/[。！？!?；;\n]/)
      .map((item) => item.trim())
      .find((item) => item.length >= 8);
    if (firstSentence) return firstSentence;
    return title;
  }

  private deriveCategory(text: string): string {
    const normalized = text.toLowerCase();
    if (/(对比|pk|vs|测评|评测|comparison)/.test(normalized)) return 'comparison';
    if (/(教程|步骤|指南|怎么|如何|how\s*to)/.test(normalized)) return 'how_to';
    if (/(清单|合集|推荐|top|榜单|list)/.test(normalized)) return 'listicle';
    if (/(避雷|踩坑|真相|内幕|risk|avoid)/.test(normalized)) return 'risk_avoidance';
    if (/(故事|日常|复盘|经历|story)/.test(normalized)) return 'story_sell';
    return 'generic';
  }

  private deriveNarrativeStructure(input: { hook: string; transcript: string; cta: string }): string[] {
    const lines = input.transcript
      .split(/[。！？!?；;\n]/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4);
    if (lines.length >= 3) {
      return Array.from(new Set([input.hook, ...lines.slice(0, 4), input.cta].filter(Boolean)));
    }
    return Array.from(
      new Set(
        [
          input.hook,
          '放大痛点和代价',
          '给出可执行方案',
          '展示对比证据',
          input.cta || '评论区或私信领取完整方案',
        ].filter(Boolean),
      ),
    );
  }

  private deriveEmotionalTriggers(text: string): string[] {
    const map: Array<{ keyword: RegExp; label: string }> = [
      { keyword: /(省钱|低价|平替|便宜|cheap|discount)/, label: 'price_sensitivity' },
      { keyword: /(避雷|踩坑|风险|翻车|risk|safe)/, label: 'risk_aversion' },
      { keyword: /(逆袭|提升|增长|翻倍|boost|growth)/, label: 'aspiration' },
      { keyword: /(真实|亲测|实测|复盘|proof|case)/, label: 'authenticity' },
      { keyword: /(紧急|马上|立刻|别再|now|urgent)/, label: 'urgency' },
      { keyword: /(独家|内幕|秘密|方法|secret|hack)/, label: 'curiosity' },
    ];
    const normalized = text.toLowerCase();
    const triggers = map.filter((item) => item.keyword.test(normalized)).map((item) => item.label);
    return triggers.length ? triggers : ['generic_interest'];
  }

  private deriveProofPoints(input: {
    title: string;
    transcript: string;
    metrics?: RagCompetitiveSampleMetrics;
    comments: string[];
  }): string[] {
    const points: string[] = [];
    const numberMatches = `${input.title} ${input.transcript}`.match(/\d+(?:\.\d+)?(?:%|w|万|k|x)?/gi) ?? [];
    if (numberMatches.length > 0) {
      points.push(`numeric_signals:${Array.from(new Set(numberMatches)).slice(0, 4).join('|')}`);
    }
    if (input.metrics?.likes != null) points.push(`likes:${input.metrics.likes}`);
    if (input.metrics?.comments != null) points.push(`comments:${input.metrics.comments}`);
    if (input.metrics?.shares != null) points.push(`shares:${input.metrics.shares}`);
    if (input.comments.length > 0) points.push(`comment_samples:${input.comments.slice(0, 2).join(' | ')}`);
    if (points.length === 0) points.push('qualitative_signal_only');
    return points;
  }

  private deriveAntiRiskNotes(platform: CompetitivePlatform): string[] {
    const common = [
      'avoid hard-sell claims in first sentence',
      'keep action frequency under platform risk thresholds',
      'rotate expression variants to reduce repetition',
    ];
    if (platform === 'douyin') {
      return [...common, 'prefer soft CTA in comments instead of direct external links'];
    }
    if (platform === 'xiaohongshu') {
      return [...common, 'prioritize note-style storytelling before product mention'];
    }
    if (platform === 'kuaishou') {
      return [...common, 'increase community interaction before conversion CTA'];
    }
    return common;
  }

  private deriveCtaPattern(text: string): string {
    const normalized = text.toLowerCase();
    if (/(评论|留言|comment)/.test(normalized)) return 'comment_cta';
    if (/(私信|私聊|dm)/.test(normalized)) return 'dm_cta';
    if (/(链接|橱窗|主页|link)/.test(normalized)) return 'link_cta';
    return 'soft_followup_cta';
  }

  private deriveConfidence(input: {
    transcript: string;
    metrics?: RagCompetitiveSampleMetrics;
    commentCount: number;
  }): number {
    let score = 0.5;
    if (input.transcript.length >= 80) score += 0.15;
    if (input.metrics?.likes != null) score += 0.1;
    if (input.metrics?.comments != null) score += 0.1;
    if (input.metrics?.shares != null) score += 0.05;
    if (input.commentCount >= 5) score += 0.1;
    return Math.max(0.2, Math.min(0.99, score));
  }

  private composeTags(input: {
    platform: CompetitivePlatform;
    category: string;
    industry?: string;
    niche?: string;
    scenario?: string;
    emotionalTriggers: string[];
  }): string[] {
    return Array.from(
      new Set(
        [
          `platform:${input.platform}`,
          `category:${input.category}`,
          input.industry ? `industry:${this.cleanText(input.industry).toLowerCase()}` : '',
          input.niche ? `niche:${this.cleanText(input.niche).toLowerCase()}` : '',
          input.scenario ? `scenario:${this.cleanText(input.scenario).toLowerCase()}` : '',
          ...input.emotionalTriggers.map((trigger) => `emotion:${trigger}`),
          'source:competitive_analysis',
        ].filter(Boolean),
      ),
    );
  }

  private normalizeMetrics(metrics: RagCompetitiveSampleMetrics | undefined): RagCompetitiveSampleMetrics | undefined {
    if (!metrics) return undefined;
    const parse = (value: unknown): number | undefined => {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) return undefined;
      return parsed;
    };
    const normalized: RagCompetitiveSampleMetrics = {
      views: parse(metrics.views),
      likes: parse(metrics.likes),
      comments: parse(metrics.comments),
      shares: parse(metrics.shares),
      saves: parse(metrics.saves),
    };
    if (
      normalized.views == null &&
      normalized.likes == null &&
      normalized.comments == null &&
      normalized.shares == null &&
      normalized.saves == null
    ) {
      return undefined;
    }
    return normalized;
  }

  private buildFingerprint(input: {
    platform: CompetitivePlatform;
    accountId: string;
    title: string;
    hook: string;
    transcript: string;
  }): string {
    return createHash('sha1')
      .update([input.platform, input.accountId, input.title, input.hook, input.transcript].join('|'))
      .digest('hex')
      .slice(0, 16);
  }

  private buildRadarInsight(input: {
    platform: CompetitivePlatform;
    accountName: string;
    accountId: string;
    metrics?: RagCompetitiveSampleMetrics;
  }): string {
    const accountRef = input.accountName || input.accountId || 'unknown_account';
    const likes = input.metrics?.likes != null ? `likes=${input.metrics.likes}` : 'likes=unknown';
    const comments = input.metrics?.comments != null ? `comments=${input.metrics.comments}` : 'comments=unknown';
    return `Radar captured competitive signal from ${input.platform}/${accountRef} (${likes}, ${comments}).`;
  }

  private buildStrategistInsight(input: {
    category: string;
    emotionalTriggers: string[];
    proofPoints: string[];
  }): string {
    return `Strategist classifies this as ${input.category}; trigger=${input.emotionalTriggers.join(',')}; proof=${input.proofPoints.slice(0, 2).join(';')}.`;
  }

  private buildInkwriterInsight(input: {
    hook: string;
    narrativeStructure: string[];
    cta: string;
  }): string {
    const stages = input.narrativeStructure.slice(0, 4).join(' -> ');
    return `InkWriter reusable frame: "${input.hook}" -> ${stages} -> ${input.cta || 'soft CTA'}.`;
  }

  private buildVisualizerInsight(input: {
    narrativeStructure: string[];
    emotionalTriggers: string[];
  }): string {
    return `Visualizer should map storyboard from: ${input.narrativeStructure.slice(0, 3).join(' | ')} with tone ${input.emotionalTriggers[0] ?? 'generic_interest'}.`;
  }

  private buildDispatcherInsight(input: {
    platform: CompetitivePlatform;
    category: string;
    confidence: number;
  }): string {
    return `Dispatcher rollout hint: platform=${input.platform}, category=${input.category}, confidence=${input.confidence.toFixed(2)}.`;
  }
}
