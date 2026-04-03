'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, PencilLine, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import {
  createAdminResource,
  deleteAdminResource,
  fetchAdminResourceList,
  fetchAdminResources,
  updateAdminResource,
  type AdminResourceMeta,
} from '@/services/endpoints/admin-control-panel';

const BORDER = 'rgba(71,85,105,0.42)';

const CREATE_ENABLED = new Set(['accounts', 'sop-templates', 'tenants']);
const EDIT_ENABLED = new Set(['lobsters', 'accounts', 'sop-templates', 'tenants', 'workflows']);
const DELETE_ENABLED = new Set(['accounts', 'sop-templates', 'tenants']);

export default function ControlPanelPage() {
  const [selectedResource, setSelectedResource] = useState('lobsters');
  const [selectedId, setSelectedId] = useState('');
  const [editorText, setEditorText] = useState('{}');
  const [createText, setCreateText] = useState('{}');
  const resourcesQuery = useQuery({
    queryKey: ['admin-crud', 'resources'],
    queryFn: fetchAdminResources,
  });
  const listQuery = useQuery({
    queryKey: ['admin-crud', 'list', selectedResource],
    queryFn: () => fetchAdminResourceList(selectedResource, selectedResource === 'lobsters' ? { tenant_id: 'tenant_main' } : undefined),
  });

  const resources = resourcesQuery.data?.resources ?? [];
  const items = listQuery.data?.items ?? [];
  const selectedResourceMeta = useMemo<AdminResourceMeta | undefined>(
    () => resources.find((item) => item.name === selectedResource),
    [resources, selectedResource],
  );
  const selectedItem = useMemo(() => items.find((item) => resolveItemId(item) === selectedId) ?? null, [items, selectedId]);

  useEffect(() => {
    if (!selectedItem) {
      setEditorText('{}');
      return;
    }
    setEditorText(JSON.stringify(selectedItem, null, 2));
  }, [selectedItem]);

  async function handleCreate() {
    try {
      const payload = JSON.parse(createText || '{}') as Record<string, unknown>;
      const result = await createAdminResource(selectedResource, payload);
      triggerSuccessToast(`已创建 ${selectedResource}`);
      setCreateText('{}');
      await listQuery.refetch();
      if ('id' in result && typeof result.id === 'string') {
        setSelectedId(result.id);
      }
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '创建失败');
    }
  }

  async function handleSave() {
    if (!selectedItem) return;
    try {
      const payload = JSON.parse(editorText || '{}') as Record<string, unknown>;
      const itemId = resolveItemId(selectedItem);
      await updateAdminResource(selectedResource, itemId, payload, selectedResource === 'lobsters' ? { tenant_id: 'tenant_main' } : undefined);
      triggerSuccessToast(`已保存 ${itemId}`);
      await listQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '保存失败');
    }
  }

  async function handleDelete() {
    if (!selectedItem) return;
    try {
      const itemId = resolveItemId(selectedItem);
      await deleteAdminResource(selectedResource, itemId);
      triggerSuccessToast(`已删除 ${itemId}`);
      setSelectedId('');
      await listQuery.refetch();
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '删除失败');
    }
  }

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-[28px] border p-6" style={{ borderColor: BORDER, background: 'linear-gradient(180deg, rgba(15,23,42,0.96), rgba(9,18,34,0.96))' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Database className="h-4 w-4" />
              Refine 风格控制面
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-white">运营控制台 CRUD</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
              把龙虾、账号、SOP 模板、边缘节点、租户这些后台资源拉到一个统一控制面里，先做标准 CRUD，再决定是否继续接真正的 Refine 组件栈。
            </p>
          </div>
          <Button variant="ghost" onClick={() => void Promise.all([resourcesQuery.refetch(), listQuery.refetch()])}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[260px_1fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Resources</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {resources.map((resource) => (
              <button
                key={resource.name}
                type="button"
                onClick={() => { setSelectedResource(resource.name); setSelectedId(''); }}
                className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                  selectedResource === resource.name
                    ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100'
                    : 'border-white/10 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70'
                }`}
              >
                <div className="font-medium">{resource.label}</div>
                <div className="mt-1 text-xs opacity-70">{resource.operations.join(' / ')}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>{selectedResourceMeta?.label ?? selectedResource}</CardTitle>
            {CREATE_ENABLED.has(selectedResource) ? (
              <Button onClick={() => void handleCreate()}>
                <Plus className="h-4 w-4" />
                创建
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {CREATE_ENABLED.has(selectedResource) ? (
              <Textarea
                rows={8}
                value={createText}
                onChange={(event) => setCreateText(event.target.value)}
                placeholder="新建 payload JSON"
              />
            ) : null}
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 bg-slate-950/70 text-slate-400">
                  <tr>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">摘要</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const itemId = resolveItemId(item);
                    return (
                      <tr
                        key={itemId}
                        className={`cursor-pointer border-b border-white/6 last:border-0 ${selectedId === itemId ? 'bg-cyan-400/10' : 'bg-transparent'}`}
                        onClick={() => setSelectedId(itemId)}
                      >
                        <td className="px-4 py-3 text-white">{itemId}</td>
                        <td className="px-4 py-3 text-slate-300">{summarizeItem(item)}</td>
                      </tr>
                    );
                  })}
                  {items.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-500" colSpan={2}>当前资源暂无数据</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>编辑器</CardTitle>
            <div className="flex gap-2">
              {EDIT_ENABLED.has(selectedResource) ? (
                <Button onClick={() => void handleSave()}>
                  <PencilLine className="h-4 w-4" />
                  保存
                </Button>
              ) : null}
              {DELETE_ENABLED.has(selectedResource) ? (
                <Button variant="ghost" onClick={() => void handleDelete()}>
                  <Trash2 className="h-4 w-4" />
                  删除
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input value={selectedId} onChange={(event) => setSelectedId(event.target.value)} placeholder="当前选中 ID" />
            <Textarea
              rows={22}
              value={editorText}
              onChange={(event) => setEditorText(event.target.value)}
              placeholder="选择左侧资源后在这里编辑 JSON"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function resolveItemId(item: Record<string, unknown>): string {
  const keys = ['id', 'lobster_id', 'tenant_id', 'job_id', 'edge_id', 'rule_id'];
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return 'unknown';
}

function summarizeItem(item: Record<string, unknown>): string {
  return (
    String(item.name ?? item.display_name ?? item.title ?? item.platform ?? item.status ?? item.channel ?? item.description ?? '')
      .slice(0, 90) || '—'
  );
}
