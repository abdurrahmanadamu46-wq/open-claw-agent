'use client';

import { Label, ReferenceLine } from 'recharts';
import type { ChartAnnotation } from '@/types/chart-annotation';

export function ChartAnnotationLines({
  annotations,
  toXAxisValue,
}: {
  annotations: ChartAnnotation[];
  toXAxisValue: (timestamp: string) => string;
}) {
  return (
    <>
      {annotations.map((annotation) => (
        <ReferenceLine
          key={annotation.id}
          x={toXAxisValue(annotation.timestamp)}
          stroke={annotation.color || '#888888'}
          strokeDasharray="3 3"
          strokeWidth={1.5}
        >
          <Label
            value={annotation.label}
            position="insideTopRight"
            style={{ fontSize: 10, fill: annotation.color || '#888888' }}
          />
        </ReferenceLine>
      ))}
    </>
  );
}

export function AnnotationLegend({ annotations }: { annotations: ChartAnnotation[] }) {
  if (annotations.length === 0) return null;
  const groups = Object.entries(
    annotations.reduce<Record<string, number>>((acc, item) => {
      acc[item.annotation_type] = (acc[item.annotation_type] || 0) + 1;
      return acc;
    }, {}),
  );
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
      {groups.map(([type, count]) => {
        const color = annotations.find((item) => item.annotation_type === type)?.color || '#888888';
        return (
          <div key={type} className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4" style={{ backgroundColor: color, borderTop: `2px dashed ${color}` }} />
            <span>{count} 个 {type}</span>
          </div>
        );
      })}
    </div>
  );
}
