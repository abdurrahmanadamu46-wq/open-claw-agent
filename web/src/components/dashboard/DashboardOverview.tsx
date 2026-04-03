'use client';

import { useRouter } from 'next/navigation';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { Button } from '@/components/ui/Button';

const PLATFORM_ICONS: Record<string, string> = {
  视频号: '🎴',
  快手: '⏩',
  小红书: '📃',
  抖音: '🎍',
  TikTok: '🎪',
};

export interface AccountRow {
  id: string;
  platform: string;
  nickname: string;
  cookieValid: boolean;
  todayUsed: number;
  todayLimit: number;
}

export interface TrendPoint {
  date: string;
  uv: number;
  pv: number;
}

export interface AudiencePoint {
  name: string;
  value: number;
  color: string;
}

export interface DashboardOverviewProps {
  showAccountMatrix?: boolean;
  showCompetitorTrend?: boolean;
  showAudience?: boolean;
  accounts?: AccountRow[];
  trendData?: TrendPoint[];
  audienceData?: AudiencePoint[];
}

export function DashboardOverview({
  showAccountMatrix = true,
  showCompetitorTrend = true,
  showAudience = true,
  accounts = [],
  trendData = [],
  audienceData = [],
}: DashboardOverviewProps = {}) {
  const router = useRouter();

  const handleReAuth = () => {
    router.push('/settings/integrations');
  };

  return (
    <div className="space-y-6">
      {showAccountMatrix && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-base" style={{ color: '#F8FAFC' }}>
              账号矩阵状态
            </CardTitle>
            <Button onClick={handleReAuth} variant="primary">
              前往账号授权
            </Button>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">
                暂无账号数据，请先完成边缘节点与账号授权。
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                <table className="w-full text-left text-sm" style={{ color: '#F8FAFC' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <th className="px-4 py-3 font-medium">平台</th>
                      <th className="px-4 py-3 font-medium">账号名称</th>
                      <th className="px-4 py-3 font-medium">Cookie 状态</th>
                      <th className="px-4 py-3 font-medium w-48">今日发布限额进度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((row) => (
                      <tr key={row.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <td className="px-4 py-3">
                          <span className="mr-2 text-lg" aria-hidden>
                            {PLATFORM_ICONS[row.platform] ?? '📫'}
                          </span>
                          {row.platform}
                        </td>
                        <td className="px-4 py-3">{row.nickname}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5" aria-label={row.cookieValid ? '有效' : '失效'}>
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.cookieValid ? '#22c55e' : '#ef4444' }} />
                            {row.cookieValid ? '有效' : '失效'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Progress value={row.todayLimit ? (row.todayUsed / row.todayLimit) * 100 : 0} className="flex-1 max-w-[180px]" />
                            <span className="shrink-0 text-xs" style={{ color: '#94A3B8' }}>
                              {row.todayUsed}/{row.todayLimit}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {showCompetitorTrend && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base" style={{ color: '#F8FAFC' }}>
                竞品趋势
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trendData.length === 0 ? (
                <div className="rounded-lg border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">
                  暂无竞品趋势数据。
                </div>
              ) : (
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
                      <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1E293B',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                        }}
                        labelStyle={{ color: '#F8FAFC' }}
                      />
                      <Line type="monotone" dataKey="uv" name="爆款数" stroke="#E5A93D" strokeWidth={2} dot={{ fill: '#E5A93D', r: 3 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="pv" name="曝光" stroke="#C66A28" strokeWidth={2} dot={{ fill: '#C66A28', r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {showAudience && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base" style={{ color: '#F8FAFC' }}>
                受众画像
              </CardTitle>
            </CardHeader>
            <CardContent>
              {audienceData.length === 0 ? (
                <div className="rounded-lg border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">
                  暂无受众画像数据。
                </div>
              ) : (
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={audienceData}
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={88}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={{ stroke: '#94A3B8' }}
                      >
                        {audienceData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1E293B',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                        }}
                        formatter={(value: number) => [value, '人数']}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span style={{ color: '#F8FAFC' }}>{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
