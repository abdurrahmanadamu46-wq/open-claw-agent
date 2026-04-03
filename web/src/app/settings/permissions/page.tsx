'use client';

import { useEffect, useState } from 'react';
import { Shield, Trash2 } from 'lucide-react';
import {
  checkRbacPermission,
  createRbacPermission,
  deleteRbacPermission,
  fetchRbacMatrix,
  fetchRbacPermissions,
  fetchUserRbacPermissions,
} from '@/services/endpoints/ai-subservice';
import type { ResourcePermission, ResourceScope, ResourceType, SubjectType } from '@/types/rbac-permission';
import { getCurrentUser } from '@/services/endpoints/user';

const BORDER = 'rgba(71,85,105,0.45)';

const RESOURCE_TYPES: ResourceType[] = ['lobster', 'workflow', 'channel', 'api_key', 'edge_node', 'skill', 'memory', 'report', 'tenant'];
const SCOPES: ResourceScope[] = ['read', 'write', 'execute', 'admin'];

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<ResourcePermission[]>([]);
  const [matrix, setMatrix] = useState<Record<string, Record<string, string[]>>>({});
  const [roles, setRoles] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [userPermissions, setUserPermissions] = useState<ResourcePermission[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<{
    resource_type: ResourceType;
    resource_id: string;
    scope: ResourceScope;
    subject_type: SubjectType;
    subject_id: string;
    granted: boolean;
    note: string;
  }>({
    resource_type: 'lobster',
    resource_id: '*',
    scope: 'execute',
    subject_type: 'role',
    subject_id: 'operator',
    granted: true,
    note: '',
  });
  const [checkResult, setCheckResult] = useState<string>('');

  async function refresh() {
    setLoading(true);
    try {
      const [permRes, matrixRes, me] = await Promise.all([
        fetchRbacPermissions(),
        fetchRbacMatrix(),
        getCurrentUser(),
      ]);
      setPermissions(permRes.permissions ?? []);
      setMatrix(matrixRes.matrix ?? {});
      setRoles(matrixRes.roles ?? []);
      if (!selectedUserId && me?.id) {
        setSelectedUserId(me.id);
      }
      setMessage('资源级 RBAC 规则已同步。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取权限失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedUserId) return;
    void fetchUserRbacPermissions(selectedUserId)
      .then((res) => setUserPermissions(res.permissions ?? []))
      .catch(() => setUserPermissions([]));
  }, [selectedUserId]);

  async function handleCreate() {
    try {
      const res = await createRbacPermission(form);
      setMessage(`已创建权限规则 ${res.permission.id}`);
      setForm((prev) => ({ ...prev, resource_id: '*', note: '' }));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建失败');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteRbacPermission(id);
      setMessage(`已删除规则 ${id}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败');
    }
  }

  async function handleCheck() {
    try {
      const result = await checkRbacPermission({
        user_id: selectedUserId || 'unknown',
        resource_type: form.resource_type,
        resource_id: form.resource_id,
        scope: form.scope,
        roles: form.subject_type === 'role' ? [form.subject_id] : undefined,
      });
      setCheckResult(result.allowed ? `允许：${result.reason}` : `拒绝：${result.reason}`);
    } catch (error) {
      setCheckResult(error instanceof Error ? error.message : '检查失败');
    }
  }

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-white">
              <Shield className="h-5 w-5 text-cyan-300" />
              <h1 className="text-2xl font-semibold">资源级 RBAC</h1>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              按资源类型、资源 ID、操作范围给角色或用户授权。默认角色矩阵保留，下面的规则是叠加覆盖层。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-2xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100"
          >
            {loading ? '同步中...' : '刷新'}
          </button>
        </div>
        <div className="mt-3 text-sm text-cyan-100">{message}</div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <h2 className="text-lg font-semibold text-white">新增规则</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-300">
              资源类型
              <select
                value={form.resource_type}
                onChange={(e) => setForm((prev) => ({ ...prev, resource_type: e.target.value as ResourceType }))}
                className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
                style={{ borderColor: BORDER }}
              >
                {RESOURCE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-300">
              资源 ID
              <input
                value={form.resource_id}
                onChange={(e) => setForm((prev) => ({ ...prev, resource_id: e.target.value }))}
                className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
                style={{ borderColor: BORDER }}
                placeholder="* 或具体资源 ID"
              />
            </label>
            <label className="text-sm text-slate-300">
              操作范围
              <select
                value={form.scope}
                onChange={(e) => setForm((prev) => ({ ...prev, scope: e.target.value as ResourceScope }))}
                className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
                style={{ borderColor: BORDER }}
              >
                {SCOPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-300">
              主体类型
              <select
                value={form.subject_type}
                onChange={(e) => setForm((prev) => ({ ...prev, subject_type: e.target.value as SubjectType }))}
                className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
                style={{ borderColor: BORDER }}
              >
                <option value="role">role</option>
                <option value="user">user</option>
              </select>
            </label>
            <label className="text-sm text-slate-300">
              主体 ID
              <input
                value={form.subject_id}
                onChange={(e) => setForm((prev) => ({ ...prev, subject_id: e.target.value }))}
                className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
                style={{ borderColor: BORDER }}
                placeholder={form.subject_type === 'role' ? 'operator / viewer' : 'user id'}
              />
            </label>
            <label className="text-sm text-slate-300">
              备注
              <input
                value={form.note}
                onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
                style={{ borderColor: BORDER }}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.granted}
                onChange={(e) => setForm((prev) => ({ ...prev, granted: e.target.checked }))}
              />
              授权
            </label>
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="rounded-2xl border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100"
            >
              新增规则
            </button>
            <button
              type="button"
              onClick={() => void handleCheck()}
              className="rounded-2xl border border-amber-400/35 bg-amber-400/10 px-4 py-2 text-sm text-amber-100"
            >
              测试规则
            </button>
            {checkResult ? <span className="self-center text-sm text-slate-300">{checkResult}</span> : null}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <h2 className="text-lg font-semibold text-white">默认角色矩阵</h2>
          <div className="mt-4 space-y-4">
            {roles.map((role) => (
              <div key={role.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">{role.name}</div>
                <div className="mt-1 text-xs text-slate-400">{role.description}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(matrix[role.id] ?? {}).map(([resource, actions]) => (
                    <span key={`${role.id}-${resource}`} className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                      {resource}: {(actions ?? []).join(', ') || '—'}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <h2 className="text-lg font-semibold text-white">已配置规则</h2>
          <div className="mt-4 space-y-3">
            {permissions.length === 0 ? (
              <div className="text-sm text-slate-400">当前租户还没有自定义资源权限规则。</div>
            ) : permissions.map((perm) => (
              <div key={perm.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{perm.subject_type}:{perm.subject_id}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {perm.resource_type}/{perm.resource_id} · {perm.scope} · {perm.granted ? 'grant' : 'deny'}
                  </div>
                  {perm.note ? <div className="mt-1 text-xs text-slate-500">{perm.note}</div> : null}
                </div>
                <button type="button" onClick={() => void handleDelete(perm.id)} className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-2 text-rose-100">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <h2 className="text-lg font-semibold text-white">按用户查看有效权限</h2>
          <label className="mt-4 block text-sm text-slate-300">
            用户 ID
            <input
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="mt-2 w-full rounded-2xl border bg-slate-950 px-3 py-2 text-sm text-white"
              style={{ borderColor: BORDER }}
            />
          </label>
          <div className="mt-4 space-y-3">
            {userPermissions.length === 0 ? (
              <div className="text-sm text-slate-400">暂无可展示的有效权限。</div>
            ) : userPermissions.map((perm) => (
              <div key={perm.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="text-sm font-semibold text-white">{perm.resource_type}/{perm.resource_id}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {perm.scope} · {perm.subject_type}:{perm.subject_id} · {perm.source ?? 'custom'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
