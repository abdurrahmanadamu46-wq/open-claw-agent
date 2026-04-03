'use client';

/** 意向分展示：高意向绿色，低意向灰色 */
export function LeadScoreTag({ score }: { score: number }) {
  const cls =
    score >= 80 ? 'bg-green-100 text-green-800' : score >= 60 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {score}
    </span>
  );
}
