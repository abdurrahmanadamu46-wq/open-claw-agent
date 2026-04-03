'use client';

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Shield, UserRound, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { getCurrentUser, listTeamUsers } from '@/services/endpoints/user';

export default function TeamPage() {
  const currentUserQuery = useQuery({
    queryKey: ['settings', 'team', 'current-user'],
    queryFn: getCurrentUser,
  });
  const teamUsersQuery = useQuery({
    queryKey: ['settings', 'team', 'users'],
    queryFn: listTeamUsers,
    retry: false,
  });

  const currentUser = currentUserQuery.data;
  const tenantId = teamUsersQuery.data?.tenantId ?? currentUser?.tenantId ?? '-';
  const teamUsers = useMemo(() => teamUsersQuery.data?.users ?? [], [teamUsersQuery.data?.users]);
  const roleBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const user of teamUsers) {
      for (const role of user.roles) {
        map.set(role, (map.get(role) ?? 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [teamUsers]);

  const teamQueryForbidden =
    teamUsersQuery.isError &&
    String((teamUsersQuery.error as { message?: string } | undefined)?.message ?? '').includes('403');

  return (
    <div className="min-h-[calc(100vh-5rem)] p-6" style={{ backgroundColor: '#0F172A' }}>
      <div className="mx-auto max-w-6xl space-y-5">
        <section
          className="rounded-2xl border px-6 py-5"
          style={{ borderColor: 'rgba(71,85,105,0.45)', backgroundColor: 'rgba(30,41,59,0.72)' }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-100">Team Access</h1>
              <p className="mt-1 text-sm text-slate-400">
                This page shows the live session and the configured RBAC members for the current tenant.
                To keep the closing pass safe, team settings are read-only for now.
              </p>
            </div>
            <div
              className="rounded-lg border px-3 py-2 text-xs text-cyan-200"
              style={{ borderColor: 'rgba(34,211,238,0.35)', backgroundColor: 'rgba(34,211,238,0.12)' }}
            >
              tenant: {tenantId}
            </div>
          </div>
        </section>

        {(currentUserQuery.isError || (teamUsersQuery.isError && !teamQueryForbidden)) ? (
          <div
            className="flex items-start gap-2 rounded-xl border px-4 py-3 text-sm text-rose-200"
            style={{ borderColor: 'rgba(239,68,68,0.45)', backgroundColor: 'rgba(127,29,29,0.25)' }}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Failed to load team data. Check the current login session and backend service.</span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={<UserRound className="h-5 w-5 text-cyan-300" />} label="Current user" value={currentUser?.name ?? '-'} />
          <MetricCard icon={<Shield className="h-5 w-5 text-amber-300" />} label="Primary role" value={currentUser?.role ?? '-'} />
          <MetricCard icon={<Users className="h-5 w-5 text-emerald-300" />} label="Team size" value={teamQueryForbidden ? 'restricted' : String(teamUsers.length)} />
          <MetricCard icon={<Shield className="h-5 w-5 text-sky-300" />} label="Admin mode" value={currentUser?.isAdmin ? 'yes' : 'no'} />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Current session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-200">
              {!currentUser ? (
                <div className="text-slate-400">No active session details</div>
              ) : (
                <>
                  <InfoRow label="User ID" value={currentUser.id} />
                  <InfoRow label="Name" value={currentUser.name} />
                  <InfoRow label="Tenant" value={currentUser.tenantId ?? '-'} />
                  <InfoRow label="Role" value={currentUser.role} />
                  <InfoRow label="All roles" value={(currentUser.roles ?? [currentUser.role]).join(', ')} />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Role breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {teamQueryForbidden ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-200">
                  This account is not an admin, so the full member list is hidden.
                </div>
              ) : roleBreakdown.length === 0 ? (
                <div className="text-sm text-slate-400">No role data yet</div>
              ) : (
                roleBreakdown.map(([role, count]) => (
                  <div key={role} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm">
                    <span className="text-slate-100">{role}</span>
                    <span className="text-slate-300">{count}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Configured members</CardTitle>
          </CardHeader>
          <CardContent>
            {teamQueryForbidden ? (
              <div className="text-sm text-slate-400">Full member data is visible to admins only.</div>
            ) : teamUsers.length === 0 ? (
              <div className="text-sm text-slate-400">No team members configured.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Username</th>
                      <th className="px-3 py-2">Tenant</th>
                      <th className="px-3 py-2">Roles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamUsers.map((user) => (
                      <tr key={`${user.tenantId}:${user.username}`} className="border-b border-slate-800 text-slate-200">
                        <td className="px-3 py-2">{user.name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{user.username}</td>
                        <td className="px-3 py-2">{user.tenantId}</td>
                        <td className="px-3 py-2">{user.roles.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'rgba(71,85,105,0.4)', backgroundColor: 'rgba(30,41,59,0.8)' }}>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-2 last:border-b-0">
      <span className="text-slate-400">{label}</span>
      <span className="text-right text-slate-100">{value}</span>
    </div>
  );
}
