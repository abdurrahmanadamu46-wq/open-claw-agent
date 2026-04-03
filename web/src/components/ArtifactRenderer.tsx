'use client';

import { useMemo, useState } from 'react';

type ArtifactBlock = {
  type: string;
  content: string;
  language?: string;
  title?: string;
  metadata?: Record<string, unknown>;
};

function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const splitLine = (line: string) => line.split(',').map((cell) => cell.trim());
  return {
    headers: splitLine(lines[0]),
    rows: lines.slice(1).map(splitLine),
  };
}

function classifyArtifacts(content: string): ArtifactBlock[] {
  const text = String(content || '').trim();
  if (!text) return [{ type: 'text', content: '' }];
  const blocks: ArtifactBlock[] = [];
  const consume: Array<[number, number]> = [];
  const mark = (match: RegExpExecArray, block: ArtifactBlock) => {
    consume.push([match.index, match.index + match[0].length]);
    blocks.push(block);
  };

  const mermaid = /```mermaid\s*\n([\s\S]*?)```/gi;
  const html = /```html\s*\n([\s\S]*?)```/gi;
  const csv = /```csv\s*\n([\s\S]*?)```/gi;
  const code = /```([a-zA-Z0-9_+-]+)?\s*\n([\s\S]*?)```/g;
  const svg = /(<svg[\s\S]*?<\/svg>)/gi;
  const image = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|\b(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg))/gi;

  let match: RegExpExecArray | null;
  while ((match = mermaid.exec(text))) mark(match, { type: 'mermaid', content: match[1].trim(), title: 'Mermaid Diagram' });
  while ((match = html.exec(text))) mark(match, { type: 'html', content: match[1].trim(), title: 'HTML Preview' });
  while ((match = csv.exec(text))) mark(match, { type: 'table_csv', content: match[1].trim(), title: 'CSV Table' });
  while ((match = svg.exec(text))) mark(match, { type: 'svg', content: match[1].trim(), title: 'SVG Preview' });
  while ((match = image.exec(text))) mark(match, { type: 'image_url', content: (match[1] || match[2] || '').trim(), title: 'Image Preview' });

  const stripped = (() => {
    if (consume.length === 0) return text;
    const ordered = [...consume].sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    let out = '';
    for (const [start, end] of ordered) {
      if (start > cursor) out += text.slice(cursor, start);
      cursor = Math.max(cursor, end);
    }
    if (cursor < text.length) out += text.slice(cursor);
    return out;
  })();

  let codeMatch: RegExpExecArray | null;
  while ((codeMatch = code.exec(stripped))) {
    const language = String(codeMatch[1] || 'text').toLowerCase();
    if (['mermaid', 'html', 'csv'].includes(language)) continue;
    blocks.push({ type: 'code', content: codeMatch[2].trim(), language, title: `${language} code` });
  }

  const plain = stripped.replace(code, '').trim();
  if (plain) {
    blocks.unshift({ type: plain.startsWith('{') || plain.startsWith('[') ? 'json_data' : 'markdown_rich', content: plain, title: 'Content' });
  }
  return blocks.length > 0 ? blocks : [{ type: 'markdown_rich', content: text, title: 'Content' }];
}

function MermaidFrame({ code }: { code: string }) {
  const srcDoc = `
<!doctype html>
<html>
  <body style="margin:0;padding:12px;background:#07111f;color:#e2e8f0;">
    <pre class="mermaid">${code.replace(/</g, '&lt;')}</pre>
    <script type="module">
      import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
      mermaid.initialize({ startOnLoad: true, theme: 'dark' });
    </script>
  </body>
</html>`;
  return <iframe title="mermaid-preview" sandbox="allow-scripts" srcDoc={srcDoc} className="h-[260px] w-full rounded-xl border border-slate-700 bg-slate-950" />;
}

export function ArtifactRenderer({ content }: { content: string }) {
  const blocks = useMemo(() => classifyArtifacts(content), [content]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(null), 1200);
    } catch {
      setCopiedIndex(null);
    }
  };

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === 'code' || block.type === 'json_data') {
          return (
            <section key={key} className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                <span>{block.title || block.language || block.type}</span>
                <button type="button" onClick={() => void copy(block.content, index)} className="rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200">
                  {copiedIndex === index ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="overflow-auto whitespace-pre-wrap text-xs text-cyan-100">{block.content}</pre>
            </section>
          );
        }
        if (block.type === 'mermaid') {
          return (
            <section key={key} className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                <span>{block.title || 'Mermaid'}</span>
                <button type="button" onClick={() => void copy(block.content, index)} className="rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200">
                  {copiedIndex === index ? 'Copied' : 'Copy'}
                </button>
              </div>
              <MermaidFrame code={block.content} />
            </section>
          );
        }
        if (block.type === 'html') {
          return (
            <section key={key} className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
              <div className="mb-2 text-xs text-slate-400">{block.title || 'HTML Preview'}</div>
              <iframe title="html-preview" sandbox="allow-same-origin" srcDoc={block.content} className="h-[260px] w-full rounded-xl border border-slate-700 bg-white" />
            </section>
          );
        }
        if (block.type === 'svg') {
          return (
            <section key={key} className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
              <div className="mb-2 text-xs text-slate-400">{block.title || 'SVG Preview'}</div>
              <div className="overflow-auto rounded-xl border border-slate-700 bg-white p-3" dangerouslySetInnerHTML={{ __html: block.content }} />
            </section>
          );
        }
        if (block.type === 'table_csv') {
          const table = parseCsv(block.content);
          return (
            <section key={key} className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
              <div className="mb-2 text-xs text-slate-400">{block.title || 'Table'}</div>
              <div className="overflow-auto rounded-xl border border-slate-700">
                <table className="min-w-full text-left text-xs text-slate-200">
                  <thead className="bg-slate-900 text-slate-400">
                    <tr>{table.headers.map((header) => <th key={header} className="px-3 py-2">{header}</th>)}</tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rowIndex) => (
                      <tr key={`${key}-row-${rowIndex}`} className="border-t border-slate-800">
                        {row.map((cell, cellIndex) => <td key={`${key}-${rowIndex}-${cellIndex}`} className="px-3 py-2">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        }
        if (block.type === 'image_url') {
          return (
            <section key={key} className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
              <div className="mb-2 text-xs text-slate-400">{block.title || 'Image'}</div>
              <img src={block.content} alt={block.title || 'artifact-image'} className="max-h-[320px] rounded-xl border border-slate-700 object-contain" />
            </section>
          );
        }
        return (
          <section key={key} className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
            <div className="mb-2 text-xs text-slate-400">{block.title || 'Content'}</div>
            <pre className="whitespace-pre-wrap text-sm text-slate-200">{block.content}</pre>
          </section>
        );
      })}
    </div>
  );
}

export function extractArtifactRenderableContent(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const candidateKeys = ['content', 'markdown', 'report_markdown', 'html', 'svg', 'mermaid', 'text', 'body', 'summary'];
  for (const key of candidateKeys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return JSON.stringify(record, null, 2);
}
