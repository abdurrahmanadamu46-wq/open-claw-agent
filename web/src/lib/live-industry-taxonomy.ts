import { INDUSTRY_TAXONOMY, findSubIndustryByTag, type IndustryCategory } from '@/lib/industry-taxonomy';
import { fetchIndustryKbTaxonomy } from '@/services/endpoints/ai-subservice';

export type LiveIndustryCategory = {
  category_tag: string;
  category_name: string;
  sub_industries: Array<{
    tag: string;
    name: string;
    aliases?: string[];
    schema?: {
      industry_name: string;
      pain_points: string[];
      jargon_terms: string[];
      solutions: string[];
      objections: string[];
      banned_absolute: string[];
      banned_industry: string[];
      risk_behaviors: string[];
    };
  }>;
};

export const LOCAL_INDUSTRY_TAXONOMY_SNAPSHOT = {
  source: 'local' as const,
  taxonomy: INDUSTRY_TAXONOMY,
};

export async function fetchLiveFirstIndustryTaxonomy(): Promise<{
  source: 'live' | 'local';
  taxonomy: IndustryCategory[];
}> {
  try {
    const data = await fetchIndustryKbTaxonomy();
    if (Array.isArray(data.taxonomy) && data.taxonomy.length > 0) {
      return {
        source: 'live',
        taxonomy: data.taxonomy as unknown as IndustryCategory[],
      };
    }
  } catch {
    // Fall back to bundled taxonomy.
  }

  return LOCAL_INDUSTRY_TAXONOMY_SNAPSHOT;
}

export type IndustryDisplayResolution = {
  tag: string;
  name: string;
  categoryTag?: string;
  categoryName?: string;
  source: 'live' | 'local' | 'raw' | 'empty';
};

export function flattenIndustryTaxonomy(taxonomy: IndustryCategory[]) {
  return taxonomy.flatMap((category) =>
    category.sub_industries.map((subIndustry) => ({
      ...subIndustry,
      category_tag: category.category_tag,
      category_name: category.category_name,
    })),
  );
}

export function resolveIndustryDisplay(options: {
  tag?: string | null;
  taxonomy?: IndustryCategory[] | null;
  source?: 'live' | 'local';
  fallbackLabel?: string | null;
}): IndustryDisplayResolution {
  const normalizedTag = String(options.tag ?? '').trim().toLowerCase();
  const fallbackLabel = String(options.fallbackLabel ?? '').trim();

  if (!normalizedTag) {
    return {
      tag: '',
      name: fallbackLabel,
      source: fallbackLabel ? 'raw' : 'empty',
    };
  }

  const liveFirstMatch = options.taxonomy?.length
    ? flattenIndustryTaxonomy(options.taxonomy).find((item) => item.tag === normalizedTag)
    : null;

  if (liveFirstMatch) {
    return {
      tag: liveFirstMatch.tag,
      name: liveFirstMatch.name,
      categoryTag: liveFirstMatch.category_tag,
      categoryName: liveFirstMatch.category_name,
      source: options.source ?? 'live',
    };
  }

  const localMatch = findSubIndustryByTag(normalizedTag);
  if (localMatch) {
    return {
      tag: localMatch.tag,
      name: localMatch.name,
      categoryTag: localMatch.category_tag,
      categoryName: localMatch.category_name,
      source: 'local',
    };
  }

  return {
    tag: normalizedTag,
    name: fallbackLabel || normalizedTag,
    source: 'raw',
  };
}

export function formatIndustryDisplayValue(
  resolution: IndustryDisplayResolution,
  options?: {
    localFallbackLabel?: string;
    rawFallbackLabel?: string;
    emptyLabel?: string;
  },
) {
  if (!resolution.name) {
    return options?.emptyLabel ?? '-';
  }

  if (resolution.source === 'local') {
    return `${resolution.name} / ${options?.localFallbackLabel ?? 'local fallback'}`;
  }

  if (resolution.source === 'raw') {
    return `${resolution.name} / ${options?.rawFallbackLabel ?? 'unmapped tag'}`;
  }

  return resolution.name;
}
