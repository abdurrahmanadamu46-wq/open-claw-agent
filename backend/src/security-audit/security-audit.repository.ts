import { Injectable } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { randomUUID } from 'node:crypto';

export type SecurityAuditReportRecord = {
  id: string;
  node_id: string;
  tenant_id?: string;
  report_text: string;
  crit_count: number;
  warn_count: number;
  ok_count: number;
  created_at: string;
};

export type SecurityKnownIssueRecord = {
  id: string;
  node_id?: string | null;
  check_name: string;
  pattern: string;
  reason: string;
  created_at: string;
};

@Injectable()
export class SecurityAuditRepository {
  private readonly reportListKey = 'security:audit:reports';
  private readonly knownIssueListKey = 'security:audit:known_issues';

  constructor(private readonly redisService: RedisService) {}

  private get redis() {
    return this.redisService.getOrThrow();
  }

  async storeReport(input: Omit<SecurityAuditReportRecord, 'id'>): Promise<SecurityAuditReportRecord> {
    const record: SecurityAuditReportRecord = {
      id: randomUUID(),
      ...input,
    };
    const key = `security:audit:report:${record.id}`;
    await this.redis
      .multi()
      .set(key, JSON.stringify(record))
      .lpush(this.reportListKey, record.id)
      .ltrim(this.reportListKey, 0, 499)
      .exec();
    return record;
  }

  async listReports(input?: { node_id?: string; limit?: number }): Promise<SecurityAuditReportRecord[]> {
    const ids = await this.redis.lrange(this.reportListKey, 0, Math.max(99, (input?.limit ?? 30) * 5));
    const items = await Promise.all(
      ids.map(async (id) => {
        const raw = await this.redis.get(`security:audit:report:${id}`);
        if (!raw) return null;
        try {
          return JSON.parse(raw) as SecurityAuditReportRecord;
        } catch {
          return null;
        }
      }),
    );
    const filtered = items.filter((item): item is SecurityAuditReportRecord => item !== null);
    const nodeId = String(input?.node_id ?? '').trim();
    const rows = nodeId ? filtered.filter((item) => item.node_id === nodeId) : filtered;
    return rows.slice(0, Math.max(1, input?.limit ?? 30));
  }

  async getReport(reportId: string): Promise<SecurityAuditReportRecord | null> {
    const raw = await this.redis.get(`security:audit:report:${reportId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SecurityAuditReportRecord;
    } catch {
      return null;
    }
  }

  async addKnownIssue(input: Omit<SecurityKnownIssueRecord, 'id' | 'created_at'>): Promise<SecurityKnownIssueRecord> {
    const record: SecurityKnownIssueRecord = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      node_id: input.node_id ? String(input.node_id).trim() : null,
      check_name: input.check_name,
      pattern: input.pattern,
      reason: input.reason,
    };
    const key = `security:audit:known_issue:${record.id}`;
    await this.redis
      .multi()
      .set(key, JSON.stringify(record))
      .lpush(this.knownIssueListKey, record.id)
      .ltrim(this.knownIssueListKey, 0, 499)
      .exec();
    return record;
  }

  async listKnownIssues(input?: { node_id?: string }): Promise<SecurityKnownIssueRecord[]> {
    const ids = await this.redis.lrange(this.knownIssueListKey, 0, 499);
    const items = await Promise.all(
      ids.map(async (id) => {
        const raw = await this.redis.get(`security:audit:known_issue:${id}`);
        if (!raw) return null;
        try {
          return JSON.parse(raw) as SecurityKnownIssueRecord;
        } catch {
          return null;
        }
      }),
    );
    const rows = items.filter((item): item is SecurityKnownIssueRecord => item !== null);
    const nodeId = String(input?.node_id ?? '').trim();
    if (!nodeId) return rows;
    return rows.filter((item) => !item.node_id || item.node_id === nodeId);
  }

  async deleteKnownIssue(issueId: string): Promise<boolean> {
    const key = `security:audit:known_issue:${issueId}`;
    const deleted = await this.redis.del(key);
    return deleted > 0;
  }
}
