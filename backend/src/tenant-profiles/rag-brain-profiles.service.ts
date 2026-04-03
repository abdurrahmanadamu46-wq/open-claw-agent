import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';
import {
  RAG_BRAIN_PROFILES_TABLE,
  type CompetitivePlatform,
  type RagBrainAgentProfile,
  type RagBrainCorpusItem,
  type RagBrainProfilesDocument,
  type RagBrainProfilesPatch,
  type RagCompetitiveFormulaRecord,
} from './tenant-profiles.types';

const RAG_BRAIN_PROFILES_KEY_PREFIX = `${RAG_BRAIN_PROFILES_TABLE}:`;
const DEFAULT_TARGET_AGENT_IDS = ['strategist', 'inkwriter', 'visualizer', 'dispatcher'];
const DEFAULT_FORMULA_LIBRARY_LIMIT = 500;

@Injectable()
export class RagBrainProfilesService {
  private readonly logger = new Logger(RagBrainProfilesService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private keyOf(tenantId: string): string {
    return `${RAG_BRAIN_PROFILES_KEY_PREFIX}${tenantId}`;
  }

  private defaultDocument(tenantId: string): RagBrainProfilesDocument {
    return {
      table: RAG_BRAIN_PROFILES_TABLE,
      tenantId,
      version: 1,
      updatedAt: new Date().toISOString(),
      agents: {},
      corpusCatalog: [],
      formulaLibrary: [],
    };
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const normalized = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    return Array.from(new Set(normalized));
  }

  private normalizeCorpora(corpora: unknown): string[] {
    return this.normalizeStringArray(corpora);
  }

  private normalizeAgentPatch(
    patch: Partial<RagBrainAgentProfile> | undefined,
    fallback: RagBrainAgentProfile | undefined,
  ): RagBrainAgentProfile {
    const base: RagBrainAgentProfile = fallback ?? { corpora: [] };
    const nextCorpora =
      patch && Object.prototype.hasOwnProperty.call(patch, 'corpora')
        ? this.normalizeCorpora(patch.corpora)
        : this.normalizeCorpora(base.corpora);
    return {
      ...base,
      ...patch,
      corpora: nextCorpora,
      updatedAt: new Date().toISOString(),
    };
  }

  private normalizeCorpusCatalog(value: unknown): RagBrainCorpusItem[] {
    if (!Array.isArray(value)) return [];
    const result: RagBrainCorpusItem[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Partial<RagBrainCorpusItem>;
      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!id) continue;
      result.push({
        id,
        name: typeof raw.name === 'string' ? raw.name.trim() : undefined,
        source: typeof raw.source === 'string' ? raw.source.trim() : undefined,
        tags: this.normalizeStringArray(raw.tags),
      });
    }
    return result;
  }

  private normalizePlatform(platform: unknown): CompetitivePlatform {
    if (typeof platform !== 'string') return 'other';
    const normalized = platform.trim().toLowerCase();
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

  private parseOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized || undefined;
  }

  private parseMetric(value: unknown): number | undefined {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    if (parsed < 0) return undefined;
    return parsed;
  }

  private parseConfidence(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return 0.5;
    return Math.max(0, Math.min(1, parsed));
  }

  private buildFingerprint(seed: {
    platform: CompetitivePlatform;
    accountId?: string;
    title: string;
    hook: string;
  }): string {
    return createHash('sha1')
      .update([seed.platform, seed.accountId ?? '', seed.title, seed.hook].join('|'))
      .digest('hex')
      .slice(0, 16);
  }

  private normalizeFormulaRecord(raw: unknown): RagCompetitiveFormulaRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as Partial<RagCompetitiveFormulaRecord>;
    const rawSource =
      source.source && typeof source.source === 'object' ? source.source : ({} as Record<string, unknown>);

    const title = this.parseOptionalString(source.title) ?? '';
    const hook = this.parseOptionalString(source.hook) ?? '';
    if (!title || !hook) return null;

    const platform = this.normalizePlatform((rawSource as { platform?: unknown }).platform);
    const accountId = this.parseOptionalString((rawSource as { accountId?: unknown }).accountId);
    const fingerprint =
      this.parseOptionalString(source.fingerprint) ??
      this.buildFingerprint({
        platform,
        accountId,
        title,
        hook,
      });
    const id = this.parseOptionalString(source.id) ?? `formula_${Date.now().toString(36)}_${fingerprint.slice(0, 8)}`;

    return {
      id,
      fingerprint,
      category: this.parseOptionalString(source.category) ?? 'generic',
      industry: this.parseOptionalString(source.industry),
      niche: this.parseOptionalString(source.niche),
      scenario: this.parseOptionalString(source.scenario),
      source: {
        platform,
        accountId,
        accountName: this.parseOptionalString((rawSource as { accountName?: unknown }).accountName),
        profileUrl: this.parseOptionalString((rawSource as { profileUrl?: unknown }).profileUrl),
        postUrl: this.parseOptionalString((rawSource as { postUrl?: unknown }).postUrl),
        capturedAt: this.parseOptionalString((rawSource as { capturedAt?: unknown }).capturedAt),
      },
      title,
      hook,
      narrativeStructure: this.normalizeStringArray(source.narrativeStructure),
      ctaPattern: this.parseOptionalString(source.ctaPattern),
      emotionalTriggers: this.normalizeStringArray(source.emotionalTriggers),
      proofPoints: this.normalizeStringArray(source.proofPoints),
      antiRiskNotes: this.normalizeStringArray(source.antiRiskNotes),
      tags: this.normalizeStringArray(source.tags),
      metrics:
        source.metrics && typeof source.metrics === 'object'
          ? {
              views: this.parseMetric((source.metrics as { views?: unknown }).views),
              likes: this.parseMetric((source.metrics as { likes?: unknown }).likes),
              comments: this.parseMetric((source.metrics as { comments?: unknown }).comments),
              shares: this.parseMetric((source.metrics as { shares?: unknown }).shares),
              saves: this.parseMetric((source.metrics as { saves?: unknown }).saves),
            }
          : undefined,
      senateInsights:
        source.senateInsights && typeof source.senateInsights === 'object'
          ? {
              radar: this.parseOptionalString((source.senateInsights as { radar?: unknown }).radar),
              strategist: this.parseOptionalString(
                (source.senateInsights as { strategist?: unknown }).strategist,
              ),
              inkwriter: this.parseOptionalString(
                (source.senateInsights as { inkwriter?: unknown }).inkwriter,
              ),
              visualizer: this.parseOptionalString(
                (source.senateInsights as { visualizer?: unknown }).visualizer,
              ),
              dispatcher: this.parseOptionalString(
                (source.senateInsights as { dispatcher?: unknown }).dispatcher,
              ),
            }
          : undefined,
      confidence: this.parseConfidence(source.confidence),
      extractedAt: this.parseOptionalString(source.extractedAt) ?? new Date().toISOString(),
    };
  }

  private normalizeFormulaLibrary(value: unknown): RagCompetitiveFormulaRecord[] {
    if (!Array.isArray(value)) return [];
    const result: RagCompetitiveFormulaRecord[] = [];
    for (const item of value) {
      const normalized = this.normalizeFormulaRecord(item);
      if (normalized) result.push(normalized);
    }
    return result;
  }

  private parseDocument(raw: string | null, tenantId: string): RagBrainProfilesDocument {
    if (!raw) return this.defaultDocument(tenantId);
    try {
      const parsed = JSON.parse(raw) as Partial<RagBrainProfilesDocument>;
      const agents: Record<string, RagBrainAgentProfile> = {};
      for (const [agentId, patch] of Object.entries(parsed.agents ?? {})) {
        agents[agentId] = this.normalizeAgentPatch(patch, undefined);
      }
      return {
        table: RAG_BRAIN_PROFILES_TABLE,
        tenantId,
        version: Number.isFinite(parsed.version) ? Number(parsed.version) : 1,
        updatedAt:
          typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim()
            ? parsed.updatedAt
            : new Date().toISOString(),
        agents,
        corpusCatalog: this.normalizeCorpusCatalog(parsed.corpusCatalog),
        formulaLibrary: this.normalizeFormulaLibrary(parsed.formulaLibrary),
      };
    } catch {
      return this.defaultDocument(tenantId);
    }
  }

  async getProfiles(tenantId: string): Promise<RagBrainProfilesDocument> {
    const key = this.keyOf(tenantId);
    return redisReadWithFallback(
      this.logger,
      `rag brain profiles get tenant=${tenantId}`,
      async () => this.parseDocument(await this.redis.get(key), tenantId),
      this.defaultDocument(tenantId),
    );
  }

  private async getProfilesForWrite(tenantId: string): Promise<RagBrainProfilesDocument> {
    const key = this.keyOf(tenantId);
    const raw = await redisWriteOrBlock(
      this.logger,
      `rag brain profiles get-for-write tenant=${tenantId}`,
      async () => this.redis.get(key),
    );
    return this.parseDocument(raw, tenantId);
  }

  async updateProfiles(
    tenantId: string,
    patch: RagBrainProfilesPatch,
  ): Promise<RagBrainProfilesDocument> {
    const current = await this.getProfilesForWrite(tenantId);
    const mergedAgents: Record<string, RagBrainAgentProfile> = { ...current.agents };
    for (const [agentId, agentPatch] of Object.entries(patch.agents ?? {})) {
      const previous = mergedAgents[agentId];
      mergedAgents[agentId] = this.normalizeAgentPatch(agentPatch, previous);
    }

    const nextFormulaLibrary = Object.prototype.hasOwnProperty.call(patch, 'formulaLibrary')
      ? this.normalizeFormulaLibrary(patch.formulaLibrary)
      : current.formulaLibrary;

    const next: RagBrainProfilesDocument = {
      ...current,
      version: Number.isFinite(patch.version) ? Number(patch.version) : current.version,
      corpusCatalog: Array.isArray(patch.corpusCatalog)
        ? this.normalizeCorpusCatalog(patch.corpusCatalog)
        : current.corpusCatalog,
      formulaLibrary: nextFormulaLibrary,
      agents: mergedAgents,
      updatedAt: new Date().toISOString(),
    };

    await redisWriteOrBlock(
      this.logger,
      `rag brain profiles update tenant=${tenantId}`,
      async () => this.redis.set(this.keyOf(tenantId), JSON.stringify(next)),
    );
    return next;
  }

  async getCompetitiveFormulaLibrary(
    tenantId: string,
    query?: {
      category?: string;
      platform?: string;
      tag?: string;
      limit?: number;
    },
  ): Promise<RagCompetitiveFormulaRecord[]> {
    const profiles = await this.getProfiles(tenantId);
    const categoryFilter = this.parseOptionalString(query?.category)?.toLowerCase();
    const platformFilter = this.parseOptionalString(query?.platform)?.toLowerCase();
    const tagFilter = this.parseOptionalString(query?.tag)?.toLowerCase();
    const limitRaw = Number(query?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;

    return profiles.formulaLibrary
      .filter((item) => {
        if (categoryFilter && item.category.toLowerCase() !== categoryFilter) return false;
        if (platformFilter && item.source.platform.toLowerCase() !== platformFilter) return false;
        if (tagFilter && !item.tags.some((tag) => tag.toLowerCase() === tagFilter)) return false;
        return true;
      })
      .sort((a, b) => b.extractedAt.localeCompare(a.extractedAt))
      .slice(0, limit);
  }

  async appendCompetitiveFormula(
    tenantId: string,
    rawFormula: unknown,
    options?: {
      upsertAsCorpus?: boolean;
      targetAgents?: string[];
      maxFormulaLibrary?: number;
    },
  ): Promise<{
    document: RagBrainProfilesDocument;
    inserted: boolean;
    formula: RagCompetitiveFormulaRecord;
    corpusId?: string;
  }> {
    const normalizedFormula = this.normalizeFormulaRecord(rawFormula);
    if (!normalizedFormula) {
      throw new Error('Invalid competitive formula payload: title/hook/source.platform are required');
    }

    const current = await this.getProfilesForWrite(tenantId);
    const rest = current.formulaLibrary.filter(
      (item) =>
        item.fingerprint !== normalizedFormula.fingerprint &&
        item.id !== normalizedFormula.id,
    );
    const inserted = rest.length === current.formulaLibrary.length;

    const maxFormulaLibrary = Number.isFinite(options?.maxFormulaLibrary)
      ? Math.max(20, Math.min(2000, Math.floor(options?.maxFormulaLibrary ?? DEFAULT_FORMULA_LIBRARY_LIMIT)))
      : DEFAULT_FORMULA_LIBRARY_LIMIT;
    const nextFormulaLibrary = [normalizedFormula, ...rest].slice(0, maxFormulaLibrary);

    const upsertAsCorpus = options?.upsertAsCorpus ?? true;
    const nextCorpusCatalog = [...current.corpusCatalog];
    let corpusId: string | undefined;
    if (upsertAsCorpus) {
      corpusId = `competitive_formula:${normalizedFormula.id}`;
      const sourceLink = normalizedFormula.source.postUrl ?? normalizedFormula.source.profileUrl;
      const corpus: RagBrainCorpusItem = {
        id: corpusId,
        name: `${normalizedFormula.source.platform}/${normalizedFormula.category}/${normalizedFormula.title}`,
        source: sourceLink,
        tags: Array.from(
          new Set(['competitive_formula', normalizedFormula.source.platform, ...normalizedFormula.tags]),
        ),
      };
      const existingIdx = nextCorpusCatalog.findIndex((item) => item.id === corpusId);
      if (existingIdx >= 0) nextCorpusCatalog[existingIdx] = corpus;
      else nextCorpusCatalog.push(corpus);
    }

    const nextAgents: Record<string, RagBrainAgentProfile> = { ...current.agents };
    if (corpusId) {
      const targetAgents = this.normalizeStringArray(options?.targetAgents);
      const effectiveTargets = targetAgents.length ? targetAgents : DEFAULT_TARGET_AGENT_IDS;
      for (const agentId of effectiveTargets) {
        const prev = nextAgents[agentId];
        nextAgents[agentId] = this.normalizeAgentPatch(
          {
            corpora: Array.from(new Set([...(prev?.corpora ?? []), corpusId])),
          },
          prev,
        );
      }
    }

    const next: RagBrainProfilesDocument = {
      ...current,
      formulaLibrary: nextFormulaLibrary,
      corpusCatalog: nextCorpusCatalog,
      agents: nextAgents,
      updatedAt: new Date().toISOString(),
    };

    await redisWriteOrBlock(
      this.logger,
      `rag brain profiles append formula tenant=${tenantId} formula=${normalizedFormula.id}`,
      async () => this.redis.set(this.keyOf(tenantId), JSON.stringify(next)),
    );

    return {
      document: next,
      inserted,
      formula: normalizedFormula,
      corpusId,
    };
  }
}
