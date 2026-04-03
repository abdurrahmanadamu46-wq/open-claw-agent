'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import type { CalendarTask } from '@/types/calendar';
import { PLATFORM_LABELS, PLATFORM_COLORS, getStatusDot } from '@/types/calendar';
import { useCampaignStore } from '@/contexts/CampaignStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog';

const BORDER = 'rgba(71,85,105,0.4)';
const CARD_BG = '#1E293B';
const MUTED = '#94A3B8';
const GOLD = '#E5A93D';

function formatDateKey(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getMonthGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startPad = first.getDay();
  const daysInMonth = last.getDate();
  const flat: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) flat.push(null);
  for (let d = 1; d <= daysInMonth; d++) flat.push(new Date(year, month, d));
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < flat.length; i += 7) rows.push(flat.slice(i, i + 7));
  return rows;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export default function OperationsCalendarPage() {
  const now = new Date();
  const todayKey = formatDateKey(now);
  const { tasks, campaigns, selectedCampaignId, setSelectedCampaignId, updateTask } = useCampaignStore();
  const [currentMonth, setCurrentMonth] = useState(now.getMonth());
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [hasConflict, setHasConflict] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<CalendarTask | null>(null);
  const [detailTime, setDetailTime] = useState('');
  const [timelineDragOver, setTimelineDragOver] = useState(false);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const draggedTaskIdRef = useRef<string | null>(null);

  const monthGrid = useMemo(() => getMonthGrid(currentYear, currentMonth), [currentYear, currentMonth]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    tasks.forEach((t) => {
      const list = map.get(t.publishDate) ?? [];
      list.push(t);
      map.set(t.publishDate, list);
    });
    map.forEach((list) => list.sort((a, b) => a.publishTime.localeCompare(b.publishTime)));
    return map;
  }, [tasks]);

  const weekPendingCount = useMemo(() => {
    const weekStart = new Date(todayKey + 'T12:00:00');
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return tasks.filter(
      (t) => t.status === 'queued' && t.publishDate >= formatDateKey(weekStart) && t.publishDate <= formatDateKey(weekEnd),
    ).length;
  }, [tasks, todayKey]);

  const todayTasks = useMemo(
    () => tasks.filter((t) => t.publishDate === todayKey).sort((a, b) => a.publishTime.localeCompare(b.publishTime)),
    [tasks, todayKey],
  );

  const moveTaskToDate = useCallback((taskId: string, targetDate: string) => {
    updateTask(taskId, { publishDate: targetDate });
  }, [updateTask]);

  const moveTaskToDateAndTime = useCallback((taskId: string, targetDate: string, targetTime: string) => {
    updateTask(taskId, { publishDate: targetDate, publishTime: targetTime });
  }, [updateTask]);

  const percentToTime = useCallback((percent: number): string => {
    const clamped = Math.max(0, Math.min(1, percent));
    const totalMinutes = Math.floor(clamped * 24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }, []);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggingId(taskId);
    draggedTaskIdRef.current = taskId;
    e.dataTransfer.setData('application/x-calendar-task-id', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setTimelineDragOver(false);
    draggedTaskIdRef.current = null;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    e.stopPropagation();
    const id = draggedTaskIdRef.current || e.dataTransfer.getData('application/x-calendar-task-id');
    if (id) moveTaskToDate(id, targetDate);
    setDraggingId(null);
    draggedTaskIdRef.current = null;
  };

  const handleTimelineDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setTimelineDragOver(true);
  };

  const handleTimelineDragLeave = (e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLDivElement).contains(e.relatedTarget as Node)) {
      setTimelineDragOver(false);
    }
  };

  const handleTimelineDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTimelineDragOver(false);
    setDraggingId(null);
    const id = draggedTaskIdRef.current || e.dataTransfer.getData('application/x-calendar-task-id');
    if (!id || !timelineContainerRef.current) {
      draggedTaskIdRef.current = null;
      return;
    }
    const rect = timelineContainerRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const percent = y / rect.height;
    const time = percentToTime(percent);
    moveTaskToDateAndTime(id, todayKey, time);
    draggedTaskIdRef.current = null;
  };

  const handleSmartReschedule = () => {
    setHasConflict(false);
    tasks.forEach((t, i) => {
      if (t.status !== 'queued') return;
      const d = new Date(t.publishDate + 'T' + t.publishTime + ':00');
      d.setMinutes(d.getMinutes() + (i % 3) * 15);
      const dateKey = formatDateKey(d);
      const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      updateTask(t.id, { publishDate: dateKey, publishTime: time });
    });
  };

  const timeToPercent = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return ((h * 60 + m) / (24 * 60)) * 100;
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col gap-4 bg-[#07111f] p-4 text-slate-50 md:p-6">
      <div
        className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border px-5 py-4"
        style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-cyan-200">Calendar</span>
          <div>
            <div className="font-semibold" style={{ color: '#F8FAFC' }}>
              算法排期官
            </div>
            <div className="text-xs" style={{ color: MUTED }}>
              AI 智能调度 · 防撞车检测
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="text-sm">
            <span style={{ color: MUTED }}>本周待发任务数 </span>
            <span className="font-mono font-semibold" style={{ color: GOLD }}>
              {weekPendingCount}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span style={{ color: MUTED }}>防撞车检测</span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium"
              style={{
                backgroundColor: hasConflict ? 'rgba(244,63,94,0.2)' : 'rgba(34,197,94,0.2)',
                color: hasConflict ? '#fb7185' : '#4ade80',
              }}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {hasConflict ? '检测到并发冲突' : '安全'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSmartReschedule}
            className="rounded-2xl px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:opacity-90"
            style={{
              background: 'var(--claw-gradient)',
              boxShadow: '0 0 20px rgba(229,169,61,0.3)',
            }}
          >
            一键智能错峰重排
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        {campaigns.length > 0 && (
          <div
            className="hidden w-56 shrink-0 flex-col overflow-hidden rounded-2xl border lg:flex"
            style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
          >
            <div className="border-b px-3 py-2" style={{ borderColor: BORDER }}>
              <span className="text-xs font-semibold uppercase" style={{ color: GOLD }}>任务筛选</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <button
                type="button"
                onClick={() => setSelectedCampaignId(null)}
                onMouseEnter={() => setSelectedCampaignId(null)}
                className="mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition"
                style={{
                  backgroundColor: selectedCampaignId === null ? 'rgba(229,169,61,0.15)' : 'transparent',
                  color: selectedCampaignId === null ? GOLD : MUTED,
                }}
              >
                全部
              </button>
              {campaigns.map((campaign) => {
                const count = tasks.filter((task) => task.campaignId === campaign.id).length;
                const active = selectedCampaignId === campaign.id;
                return (
                  <button
                    key={campaign.id}
                    type="button"
                    onClick={() => setSelectedCampaignId(campaign.id)}
                    onMouseEnter={() => setSelectedCampaignId(campaign.id)}
                    className="mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition"
                    style={{
                      backgroundColor: active ? 'rgba(229,169,61,0.15)' : 'transparent',
                      color: active ? GOLD : '#F8FAFC',
                    }}
                  >
                    <span className="font-medium">{campaign.name}</span>
                    <span className="block text-xs" style={{ color: MUTED }}>
                      {count}/{campaign.totalTickets}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="min-w-0 flex-1 overflow-auto rounded-2xl border" style={{ backgroundColor: '#0f172a', borderColor: BORDER }}>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-2" style={{ backgroundColor: CARD_BG, borderColor: BORDER }}>
            <h2 className="font-semibold" style={{ color: '#F8FAFC' }}>
              {currentYear} 年 {currentMonth + 1} 月
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (currentMonth === 0) {
                    setCurrentYear((y) => y - 1);
                    setCurrentMonth(11);
                  } else setCurrentMonth((m) => m - 1);
                }}
                className="rounded border px-2 py-1 text-xs"
                style={{ borderColor: BORDER, color: MUTED }}
              >
                上月
              </button>
              <button
                type="button"
                onClick={() => {
                  setCurrentYear(now.getFullYear());
                  setCurrentMonth(now.getMonth());
                }}
                className="rounded border px-2 py-1 text-xs"
                style={{ borderColor: BORDER, color: MUTED }}
              >
                今天
              </button>
              <button
                type="button"
                onClick={() => {
                  if (currentMonth === 11) {
                    setCurrentYear((y) => y + 1);
                    setCurrentMonth(0);
                  } else setCurrentMonth((m) => m + 1);
                }}
                className="rounded border px-2 py-1 text-xs"
                style={{ borderColor: BORDER, color: MUTED }}
              >
                下月
              </button>
            </div>
          </div>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {WEEKDAYS.map((day) => (
                  <th key={day} className="py-2 font-medium" style={{ color: MUTED }}>
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthGrid.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => {
                    const dateKey = cell ? formatDateKey(cell) : '';
                    const dayTasks = dateKey ? tasksByDate.get(dateKey) ?? [] : [];
                    const isToday = dateKey === todayKey;
                    return (
                      <td
                        key={cellIndex}
                        onDragOver={handleDragOver}
                        onDrop={(e) => dateKey && handleDrop(e, dateKey)}
                        className="align-top border p-1"
                        style={{
                          borderColor: BORDER,
                          backgroundColor: isToday ? 'rgba(229,169,61,0.08)' : undefined,
                          minHeight: 100,
                        }}
                      >
                        <div className="flex flex-col gap-1">
                          <div
                            className="text-right text-xs font-medium"
                            style={{ color: cell ? (isToday ? GOLD : MUTED) : 'transparent' }}
                          >
                            {cell?.getDate() ?? ''}
                          </div>
                          <div className="space-y-1">
                            {dayTasks.map((task) => {
                              const isDimmed = selectedCampaignId != null && task.campaignId !== selectedCampaignId;
                              const isHighlighted = selectedCampaignId != null && task.campaignId === selectedCampaignId;
                              return (
                                <div
                                  key={task.id}
                                  role="button"
                                  tabIndex={0}
                                  draggable
                                  onDragStart={(e) => handleDragStart(e, task.id)}
                                  onDragEnd={handleDragEnd}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDetailTask(task);
                                    setDetailTime(task.publishTime);
                                  }}
                                  className={`cursor-grab rounded border px-2 py-1.5 transition active:cursor-grabbing ${
                                    draggingId === task.id ? 'opacity-50' : isDimmed ? 'opacity-40' : ''
                                  }`}
                                  style={{
                                    borderColor: BORDER,
                                    backgroundColor: CARD_BG,
                                    borderLeftWidth: 3,
                                    borderLeftColor: PLATFORM_COLORS[task.platform],
                                    boxShadow: isHighlighted ? '0 0 12px rgba(229,169,61,0.35)' : undefined,
                                  }}
                                >
                                  {task.campaignName && (
                                    <div className="mb-0.5 text-[10px]" style={{ color: GOLD }}>
                                      [{task.campaignName}]
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="truncate text-xs font-medium" style={{ color: '#F8FAFC' }}>
                                      {PLATFORM_LABELS[task.platform]} · {task.accountName}
                                    </span>
                                    <span className="text-[10px]" style={{ color: MUTED }}>
                                      {getStatusDot(task.status)}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 flex items-center justify-between text-[10px]" style={{ color: MUTED }}>
                                    <span>{task.publishTime}</span>
                                    <span>{task.nodeId}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          className="relative z-10 hidden w-72 shrink-0 flex-col overflow-hidden rounded-2xl border lg:flex"
          style={{
            backgroundColor: '#020617',
            borderColor: timelineDragOver ? GOLD : BORDER,
            boxShadow: timelineDragOver ? '0 0 0 2px rgba(229,169,61,0.4)' : undefined,
          }}
        >
          <div className="border-b px-4 py-3" style={{ borderColor: BORDER }}>
            <div className="font-mono text-sm font-semibold" style={{ color: GOLD }}>
              今日发布时间轴
            </div>
            <div className="text-xs" style={{ color: MUTED }}>
              {todayKey}
              {timelineDragOver && (
                <span className="ml-2 text-amber-400">→ 松手放到此处时间</span>
              )}
            </div>
          </div>
          <div
            ref={timelineContainerRef}
            className="relative flex-1 overflow-y-auto transition-colors"
            onDragOver={handleTimelineDragOver}
            onDragLeave={handleTimelineDragLeave}
            onDrop={handleTimelineDrop}
            style={{
              backgroundColor: timelineDragOver ? 'rgba(229,169,61,0.06)' : undefined,
            }}
          >
            <div className="absolute inset-0 py-2">
              {Array.from({ length: 24 }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 border-b px-2 py-1 font-mono text-[10px]"
                  style={{ borderColor: 'rgba(255,255,255,0.06)', color: MUTED }}
                >
                  <span className="w-10 shrink-0">{String(i).padStart(2, '0')}:00</span>
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-0 pt-2">
              {todayTasks.map((task) => {
                const isDimmed = selectedCampaignId != null && task.campaignId !== selectedCampaignId;
                const isHighlighted = selectedCampaignId != null && task.campaignId === selectedCampaignId;
                return (
                  <div
                    key={task.id}
                    className="pointer-events-auto absolute left-12 right-2 rounded border px-2 py-1.5 transition"
                    style={{
                      top: `${timeToPercent(task.publishTime)}%`,
                      minHeight: 28,
                      backgroundColor: CARD_BG,
                      borderColor: PLATFORM_COLORS[task.platform],
                      borderLeftWidth: 3,
                      opacity: isDimmed ? 0.4 : 1,
                      boxShadow: task.status === 'queued' ? '0 0 12px rgba(229,169,61,0.2)' : isHighlighted ? '0 0 12px rgba(229,169,61,0.35)' : undefined,
                    }}
                  >
                    {task.campaignName && (
                      <div className="text-[10px]" style={{ color: GOLD }}>[{task.campaignName}]</div>
                    )}
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-medium" style={{ color: '#F8FAFC' }}>
                        {task.publishTime} {PLATFORM_LABELS[task.platform]} · {task.accountName}
                      </span>
                      <span className="text-[10px]">{getStatusDot(task.status)}</span>
                    </div>
                    <div className="text-[10px]" style={{ color: MUTED }}>
                      {task.nodeId}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {detailTask && (
        <Dialog open={!!detailTask} onOpenChange={(open) => !open && setDetailTask(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg">发布车票</DialogTitle>
              <DialogClose onClose={() => setDetailTask(null)} />
            </DialogHeader>
            <div className="space-y-4 px-6 pb-6">
              {detailTask.campaignName && (
                <p className="text-sm" style={{ color: GOLD }}>
                  任务 · [{detailTask.campaignName}]
                </p>
              )}
              <p className="text-sm" style={{ color: '#F8FAFC' }}>
                {PLATFORM_LABELS[detailTask.platform]} · {detailTask.accountName} · {detailTask.nodeId}
              </p>
              <div>
                <label className="mb-1 block text-xs" style={{ color: MUTED }}>发布时间</label>
                <input
                  type="text"
                  value={detailTime}
                  onChange={(e) => setDetailTime(e.target.value)}
                  placeholder="14:30"
                  className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
                  style={{ backgroundColor: '#0f172a', borderColor: BORDER, color: '#F8FAFC' }}
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    updateTask(detailTask.id, { publishTime: detailTime });
                    setDetailTask(null);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ background: 'var(--claw-gradient)' }}
                >
                  保存时间
                </button>
                {detailTask.campaignId && (
                  <Link
                    href="/campaigns"
                    className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm"
                    style={{ borderColor: BORDER, color: GOLD }}
                  >
                    查看任务列表
                  </Link>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
