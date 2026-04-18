'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, PencilLine, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { SurfaceHero, SurfaceStateCard } from '@/components/operations/SurfacePrimitives';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { triggerErrorToast, triggerSuccessToast } from '@/services/api';
import {
  createAdminResource,
  deleteAdminResource,
  fetchAdminResourceList,
  fetchAdminResources,
  type AdminResourceItem,
  type AdminResourceMeta,
  updateAdminResource,
} from '@/services/endpoints/admin-control-panel';

const BORDER = 'rgba(71,85,105,0.42)';
const CREATE_ENABLED = new Set(['accounts', 'sop-templates', 'tenants']);
const EDIT_ENABLED = new Set(['lobsters', 'accounts', 'sop-templates', 'tenants', 'workflows']);
const DELETE_ENABLED = new Set(['accounts', 'sop-templates', 'tenants']);

type AdminPayload = Record<string, unknown>;

function parseAdminPayload(value: string): AdminPayload {
  const parsed = JSON.parse(value || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as AdminPayload;
}

function resolveItemId(item: AdminResourceItem): string {
  const keys = ['id', 'lobster_id', 'tenant_id', 'job_id', 'edge_id', 'rule_id'];
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return 'unknown';
}

function summarizeItem(item: AdminResourceItem): string {
  return (
    String(
      item.name ??
        item.display_name ??
        item.title ??
        item.platform ??
        item.status ??
        item.channel ??
        item.description ??
        '',
    ).slice(0, 90) || '-'
  );
}

export default function ControlPanelPage() {
  const [selectedResource, setSelectedResource] = useState('lobsters');
  const [selectedId, setSelectedId] = useState('');
  const [editorText, setEditorText] = useState('{}');
  const [createText, setCreateText] = useState('{}');

  const resourceResult = useQuery({
    queryKey: ['admin-crud', 'resources'],
    queryFn: fetchAdminResources,
  });
  const listQuery = useQuery({
    queryKey: ['admin-crud', 'list', selectedResource],
    queryFn: () =>
      fetchAdminResourceList(
        selectedResource,
        selectedResource === 'lobsters' ? { tenant_id: 'tenant_main' } : undefined,
      ),
  });

  const resources = useMemo(() => resourceResult.data?.resources ?? [], [resourceResult.data?.resources]);
  const items = useMemo<AdminResourceItem[]>(
    () => listQuery.data?.items ?? [],
    [listQuery.data?.items],
  );
  const selectedResourceMeta = useMemo<AdminResourceMeta | undefined>(
    () => resources.find((item) => item.name === selectedResource),
    [resources, selectedResource],
  );
  const selectedItem = useMemo(
    () => items.find((item) => resolveItemId(item) === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    if (!selectedItem) {
      setEditorText('{}');
      return;
    }
    setEditorText(JSON.stringify(selectedItem, null, 2));
  }, [selectedItem]);

  async function handleCreate() {
    try {
      const payload = parseAdminPayload(createText);
      const result = await createAdminResource(selectedResource, payload);
      triggerSuccessToast(`已创建 ${selectedResource}`);
      setCreateText('{}');
      await listQuery.refetch();
      const createdId = resolveItemId(result);
      if (createdId !== 'unknown') setSelectedId(createdId);
    } catch (error) {
      triggerErrorToast(error instanceof Error ? error.message : '创建失败');
    }
  }

  async function handleSave() {
    if (!selectedItem) return;
    try {
      const payload = parseAdminPayload(editorText);
      const itemId = resolveItemId(selectedItem);
      await updateAdminResource(
        selectedResource,
        itemId,
        payload,
        selectedResource === 'lobsters' ? { tenant_id: 'tenant_main' } : undefined,
      );
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

  if (resourceResult.isLoading) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="loading"
          title="正在加载后台资源控制面"
          description="这里仅保留后台资源 CRUD 语义，不再承担链路 A 的主入口职责。"
        />
      </div>
    );
  }

  if (resourceResult.isError) {
    return (
      <div className="p-6">
        <SurfaceStateCard
          kind="error"
          title="后台资源控制面加载失败"
          description="请先检查 `/api/v1/ai/admin/resources` 是否可用。这里负责后台资源 CRUD，不再承担租户总控入口语义。"
          actionHref="/"
          actionLabel="返回租户增长总控台"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <SurfaceHero
        eyebrow="辅助页 / Control Panel"
        title="这里只保留为后台资源 CRUD 控制面，不再是链路 A 入口"
        description="链路 A 现在只认 `/` 作为唯一主入口。这里仅用于后台资源的增删改查，面向运营后台和治理辅助场景，不承接租户增长总控台语义。"
      />

      <section
        className="rounded-[28px] border p-6"
        style={{
          borderColor: BORDER,
          background: 'linear-gradient(180deg, rgba(15,23,42,0.96), rgba(9,18,34,0.96))',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-xs text-cyan-100">
              <Database className="h-4 w-4" />
              后台资源 CRUD 控制面
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-white">后台资源管理</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
              这里集中处理龙虾、账号、SOP 模板、租户、工作流等后台资源的 CRUD。它只负责资源控制，不再承接租户首页、链路 A 或演示入口语义。
            </p>
          </div>
          <Button variant="ghost" onClick={() => void Promise.all([resourceResult.refetch(), listQuery.refetch()])}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>
      </section>

      {listQuery.isError ? (
        <SurfaceStateCard
          kind="error"
          title="资源列表加载失败"
          description="当前资源目录已加载，但所选资源的数据列表拉取失败。请检查对应 admin resource 读接口。"
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[260px_1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Resources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {resources.map((resource) => (
              <button
                key={resource.name}
                type="button"
                onClick={() => {
                  setSelectedResource(resource.name);
                  setSelectedId('');
                }}
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
            {resources.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 px-4 py-6 text-sm text-slate-400">
                当前没有可用资源目录。
              </div>
            ) : null}
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
                        className={`cursor-pointer border-b border-white/6 last:border-0 ${
                          selectedId === itemId ? 'bg-cyan-400/10' : 'bg-transparent'
                        }`}
                        onClick={() => setSelectedId(itemId)}
                      >
                        <td className="px-4 py-3 text-white">{itemId}</td>
                        <td className="px-4 py-3 text-slate-300">{summarizeItem(item)}</td>
                      </tr>
                    );
                  })}
                  {items.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-500" colSpan={2}>
                        当前资源暂时没有数据
                      </td>
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
            <Input
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              placeholder="当前选中 ID"
            />
            <Textarea
              rows={22}
              value={editorText}
              onChange={(event) => setEditorText(event.target.value)}
              placeholder="选择左侧资源后，在这里编辑 JSON"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
