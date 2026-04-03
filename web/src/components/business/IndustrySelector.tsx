'use client';

import { useEffect, useMemo, useState } from 'react';
import { INDUSTRY_CATEGORIES, INDUSTRY_SUBCATEGORIES, type IndustrySubcategory } from '@/constants/industries';
import { cn } from '@/lib/utils';

type IndustrySelectorProps = {
  value?: string | null;
  onChange: (tag: string | null) => void;
  disabled?: boolean;
  categories?: string[];
  items?: IndustrySubcategory[];
  className?: string;
};

export function IndustrySelector({
  value,
  onChange,
  disabled = false,
  categories = INDUSTRY_CATEGORIES,
  items = INDUSTRY_SUBCATEGORIES,
  className,
}: IndustrySelectorProps) {
  const matched = useMemo(
    () => items.find((item) => item.tag === value),
    [items, value],
  );
  const [selectedCategory, setSelectedCategory] = useState(matched?.category ?? '');

  useEffect(() => {
    setSelectedCategory(matched?.category ?? '');
  }, [matched?.category]);

  const filteredItems = useMemo(
    () => items.filter((item) => item.category === selectedCategory),
    [items, selectedCategory],
  );

  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <select
          value={selectedCategory}
          disabled={disabled}
          onChange={(event) => {
            const nextCategory = event.target.value;
            setSelectedCategory(nextCategory);
            onChange(null);
          }}
          className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">选择行业大类</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        <select
          value={matched?.tag ?? ''}
          disabled={disabled || !selectedCategory}
          onChange={(event) => {
            const nextTag = event.target.value;
            onChange(nextTag || null);
          }}
          className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">选择子行业</option>
          {filteredItems.map((item) => (
            <option key={item.tag} value={item.tag}>
              {item.subcategory}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => {
            setSelectedCategory('');
            onChange(null);
          }}
          disabled={disabled || !value}
          className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          清空
        </button>
      </div>

      <div className="text-xs text-slate-400">
        {matched ? `当前行业：${matched.category} / ${matched.subcategory}` : '选择客户行业后，任务请求会带上行业 tag，便于龙虾加载行业专属知识。'}
      </div>
    </div>
  );
}
