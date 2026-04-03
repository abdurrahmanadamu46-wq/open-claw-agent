export interface EventBusSubjectStat {
  subject: string;
  total_count: number;
  count_last_minute: number;
  count_last_hour: number;
  rate_per_min: number;
  last_published_at: number;
}

export interface EventBusPrefixSummary {
  prefix: string;
  total_count: number;
  count_last_minute: number;
  count_last_hour: number;
  subjects: EventBusSubjectStat[];
}
