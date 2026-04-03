'use client';

import '@xterm/xterm/css/xterm.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, LoaderCircle, PlugZap, RotateCcw, TerminalSquare, Trash2 } from 'lucide-react';
import { io, type Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { DangerActionGuard } from '@/components/DangerActionGuard';
import type {
  EdgeBackupCompleteEvent,
  EdgeBackupListEvent,
  EdgeBackupRecord,
  EdgeBackupRestoreEvent,
  EdgeSecurityAuditReportEvent,
  EdgeSecurityBaselineRebuildEvent,
  EdgeRestoreCompleteEvent,
  EdgeTerminalClosedEvent,
  EdgeTerminalConnectionState,
  EdgeTerminalErrorEvent,
  EdgeTerminalOutputEvent,
  EdgeTerminalReadyEvent,
  EdgeSchedulerJobStatus,
  EdgeSchedulerStatusEvent,
  EdgeSchedulerToggleEvent,
  EdgeScheduledTaskRecord,
} from '@/types/edge-terminal';

const QUICK_COMMANDS = [
  { key: 'status', label: '状态' },
  { key: 'ps', label: '进程' },
  { key: 'disk', label: '磁盘' },
  { key: 'mem', label: '内存' },
  { key: 'log', label: '日志流' },
  { key: 'tasks', label: '任务队列' },
] as const;

function resolveTerminalBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const explicit = (process.env.NEXT_PUBLIC_API_BASE_URL || '').trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const { protocol, hostname, port } = window.location;
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return `${protocol}//${hostname}:48789`;
  }
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
}

function createSessionId(nodeId: string): string {
  return `term_${nodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatTerminalText(data: string): string {
  return String(data || '').replace(/\r?\n/g, '\r\n');
}

export function EdgeTerminalPanel({
  nodeId,
  nodeName,
  onClose,
}: {
  nodeId: string;
  nodeName?: string;
  onClose?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const sessionIdRef = useRef<string>(createSessionId(nodeId));
  const [connectionState, setConnectionState] = useState<EdgeTerminalConnectionState>('connecting');
  const [ready, setReady] = useState(false);
  const [lastMessage, setLastMessage] = useState('正在建立终端会话...');
  const [schedulerJobs, setSchedulerJobs] = useState<EdgeSchedulerJobStatus[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<EdgeScheduledTaskRecord[]>([]);
  const [backups, setBackups] = useState<EdgeBackupRecord[]>([]);
  const [securityReports, setSecurityReports] = useState<EdgeSecurityAuditReportEvent[]>([]);

  const title = useMemo(() => nodeName || nodeId, [nodeId, nodeName]);

  useEffect(() => {
    sessionIdRef.current = createSessionId(nodeId);
  }, [nodeId]);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
      convertEol: true,
      theme: {
        background: '#0b1220',
        foreground: '#d7e2f0',
        cursor: '#f8fafc',
        selectionBackground: 'rgba(56,189,248,0.28)',
      },
      scrollback: 6000,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    terminal.writeln('\x1b[36m[edge-terminal]\x1b[0m 正在连接边缘节点...');

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(containerRef.current);

    const socket = io(`${resolveTerminalBaseUrl()}/edge-terminal`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: {
        token: typeof window !== 'undefined' ? localStorage.getItem('clawcommerce_token') : '',
      },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionState('connected');
      setLastMessage('WebSocket 已连接，正在请求终端会话');
      terminal.writeln('\x1b[32m[connected]\x1b[0m WebSocket 已连接');
      socket.emit('edge_terminal_start', {
        nodeId,
        sessionId: sessionIdRef.current,
      });
    });

    socket.on('disconnect', () => {
      setConnectionState('disconnected');
      setReady(false);
      setLastMessage('连接已断开');
      terminal.writeln('\x1b[31m[disconnected]\x1b[0m 终端连接已断开');
    });

    socket.on('edge_terminal_ready', (event: EdgeTerminalReadyEvent) => {
      setReady(true);
      setLastMessage(`终端已就绪: ${event.nodeId}`);
      terminal.writeln(`\x1b[32m[ready]\x1b[0m 已连接节点 ${event.nodeId}`);
      const commands = event.availableCommands?.join(', ') || QUICK_COMMANDS.map((item) => item.key).join(', ');
      terminal.writeln(`\x1b[33m[commands]\x1b[0m ${commands}`);
      terminal.writeln('\x1b[90m提示：点击“日志流”开始实时跟随 edge-runtime 输出\x1b[0m');
      socket.emit('edge_scheduler_status', { sessionId: sessionIdRef.current });
      socket.emit('edge_backup_list', { sessionId: sessionIdRef.current });
    });

    socket.on('edge_terminal_output', (event: EdgeTerminalOutputEvent) => {
      terminal.write(formatTerminalText(event.data));
    });

    socket.on('edge_terminal_error', (event: EdgeTerminalErrorEvent) => {
      setLastMessage(event.message);
      terminal.writeln(`\x1b[31m[error]\x1b[0m ${event.message}`);
    });

    socket.on('edge_terminal_closed', (event: EdgeTerminalClosedEvent) => {
      setReady(false);
      setLastMessage(`会话已关闭: ${event.reason || 'stopped'}`);
      terminal.writeln(`\x1b[33m[closed]\x1b[0m ${event.reason || '会话已关闭'}`);
    });

    socket.on('edge_scheduler_status', (event: EdgeSchedulerStatusEvent) => {
      setSchedulerJobs(event.jobs || []);
      setScheduledTasks(event.scheduledTasks || []);
    });

    socket.on('edge_scheduler_toggle', (event: EdgeSchedulerToggleEvent) => {
      setLastMessage(event.message || '调度配置已更新');
      socket.emit('edge_scheduler_status', { sessionId: sessionIdRef.current });
    });

    socket.on('edge_backup_complete', (event: EdgeBackupCompleteEvent) => {
      setLastMessage(event.success ? '备份完成' : '备份失败');
      if (event.output) {
        terminal.writeln(formatTerminalText(`\n[backup]\n${event.output}`));
      }
      socket.emit('edge_backup_list', { sessionId: sessionIdRef.current });
    });

    socket.on('edge_backup_list', (event: EdgeBackupListEvent) => {
      setBackups(event.backups || []);
    });

    socket.on('edge_backup_restore', (event: EdgeBackupRestoreEvent) => {
      setLastMessage(event.success ? (event.dryRun ? 'Dry-run 完成' : '还原完成') : '还原失败');
      if (event.output) {
        terminal.writeln(formatTerminalText(`\n[restore]\n${event.output}`));
      }
    });

    socket.on('edge_restore_complete', (event: EdgeRestoreCompleteEvent) => {
      setLastMessage(`节点已上报恢复完成: ${event.backupName || '-'}`);
      terminal.writeln(formatTerminalText(`\n[restore-complete]\n${JSON.stringify(event, null, 2)}`));
    });

    socket.on('edge_security_audit_report', (event: EdgeSecurityAuditReportEvent) => {
      setSecurityReports((prev) => [event, ...prev].slice(0, 10));
      setLastMessage(
        event.summary.crit > 0
          ? `安全巡检发现 ${event.summary.crit} 个 critical`
          : event.summary.warn > 0
            ? `安全巡检发现 ${event.summary.warn} 个 warning`
            : '安全巡检全部正常',
      );
      terminal.writeln(formatTerminalText(`\n[security-audit]\n${event.report}`));
    });

    socket.on('edge_security_baseline_rebuild', (event: EdgeSecurityBaselineRebuildEvent) => {
      setLastMessage(event.success ? '安全基线重建完成' : '安全基线重建失败');
      terminal.writeln(
        formatTerminalText(
          `\n[security-baseline]\n${JSON.stringify(
            {
              baselineType: event.baselineType,
              rebuilt: event.rebuilt,
              success: event.success,
              timestamp: event.timestamp,
            },
            null,
            2,
          )}`,
        ),
      );
    });

    return () => {
      observer.disconnect();
      socket.emit('edge_terminal_stop', { sessionId: sessionIdRef.current });
      socket.disconnect();
      terminal.dispose();
      socketRef.current = null;
      terminalRef.current = null;
    };
  }, [nodeId]);

  const sendCommand = (command: string) => {
    if (!socketRef.current || !ready) {
      terminalRef.current?.writeln('\x1b[31m[error]\x1b[0m 终端尚未就绪');
      return;
    }
    terminalRef.current?.writeln(`\x1b[36m$ ${command}\x1b[0m`);
    socketRef.current.emit('edge_terminal_command', {
      sessionId: sessionIdRef.current,
      command,
    });
  };

  const clearScreen = () => {
    terminalRef.current?.clear();
    terminalRef.current?.writeln('\x1b[90m[clear]\x1b[0m 屏幕已清空');
  };

  const reconnect = () => {
    setConnectionState('connecting');
    setReady(false);
    setLastMessage('正在重新连接...');
    sessionIdRef.current = createSessionId(nodeId);
    socketRef.current?.disconnect();
    socketRef.current?.connect();
  };

  const requestSchedulerStatus = () => {
    if (!socketRef.current || !ready) return;
    socketRef.current.emit('edge_scheduler_status', {
      sessionId: sessionIdRef.current,
    });
  };

  const toggleSchedulerJob = (jobName: string, enabled: boolean) => {
    if (!socketRef.current || !ready) return;
    socketRef.current.emit('edge_scheduler_toggle', {
      sessionId: sessionIdRef.current,
      jobName,
      enabled,
    });
  };

  const requestBackupList = () => {
    if (!socketRef.current || !ready) return;
    socketRef.current.emit('edge_backup_list', {
      sessionId: sessionIdRef.current,
    });
  };

  const triggerBackup = () => {
    if (!socketRef.current || !ready) return;
    socketRef.current.emit('edge_backup_trigger', {
      sessionId: sessionIdRef.current,
    });
  };

  const previewRestore = (filename: string) => {
    if (!socketRef.current || !ready) return;
    socketRef.current.emit('edge_backup_restore', {
      sessionId: sessionIdRef.current,
      filename,
      dryRun: true,
    });
  };

  const runRestore = (filename: string) => {
    if (!socketRef.current || !ready) return;
    socketRef.current.emit('edge_backup_restore', {
      sessionId: sessionIdRef.current,
      filename,
      dryRun: false,
    });
  };

  const triggerSecurityAudit = () => {
    if (!socketRef.current || !ready) return;
    socketRef.current.emit('edge_security_audit_trigger', {
      sessionId: sessionIdRef.current,
    });
  };

  const rebuildSecurityBaseline = (baselineType: 'credential' | 'sop' | 'all') => {
    if (!socketRef.current || !ready) return;
    socketRef.current.emit('edge_security_baseline_rebuild', {
      sessionId: sessionIdRef.current,
      baselineType,
    });
  };

  const statusTone =
    connectionState === 'connected'
      ? 'bg-emerald-500/15 text-emerald-200'
      : connectionState === 'connecting'
        ? 'bg-amber-400/15 text-amber-200'
        : 'bg-slate-800 text-slate-300';

  return (
    <section className="rounded-[24px] border border-white/10 bg-[#0b1220] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <TerminalSquare className="h-4 w-4 text-cyan-300" />
            边缘调试终端 · {title}
          </div>
          <div className="mt-1 text-xs text-slate-400">{lastMessage}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={`rounded-full px-3 py-1 text-xs ${statusTone}`}>
            {connectionState === 'connected' ? '已连接' : connectionState === 'connecting' ? '连接中' : '已断开'}
          </div>
          <button
            type="button"
            onClick={reconnect}
            className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
          >
            {connectionState === 'connecting' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            重连
          </button>
          <button
            type="button"
            onClick={clearScreen}
            className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清屏
          </button>
          <button
            type="button"
            onClick={requestSchedulerStatus}
            disabled={!ready}
            className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Activity className="h-3.5 w-3.5" />
            调度状态
          </button>
          <button
            type="button"
            onClick={requestBackupList}
            disabled={!ready}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-3 py-2 text-xs text-amber-300 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Activity className="h-3.5 w-3.5" />
            备份列表
          </button>
          <button
            type="button"
            onClick={triggerBackup}
            disabled={!ready}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Activity className="h-3.5 w-3.5" />
            立即备份
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10"
            >
              <PlugZap className="h-3.5 w-3.5" />
              关闭
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK_COMMANDS.map((command) => (
          <button
            key={command.key}
            type="button"
            onClick={() => sendCommand(command.key)}
            disabled={!ready}
            className="rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {command.label}
          </button>
        ))}
        <div className="inline-flex items-center gap-1 rounded-md border border-slate-700/80 px-3 py-2 text-xs text-slate-500">
          <Activity className="h-3.5 w-3.5" />
          仅支持白名单命令
        </div>
      </div>

      <div ref={containerRef} className="mt-4 h-[420px] w-full overflow-hidden rounded-2xl border border-slate-800 bg-[#0a0f1a] p-2" />

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-white">边缘调度器 Job</div>
            <div className="text-xs text-slate-500">离线自治任务</div>
          </div>
          <div className="mt-3 space-y-2">
            {schedulerJobs.length ? (
              schedulerJobs.map((job) => (
                <div key={job.name} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-100">{job.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{job.description}</div>
                    </div>
                    <button
                      type="button"
                      disabled={!ready || job.name === 'heartbeat'}
                      onClick={() => toggleSchedulerJob(job.name, !job.enabled)}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        job.enabled
                          ? 'border-emerald-500/40 text-emerald-300'
                          : 'border-slate-600 text-slate-300'
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      {job.enabled ? '已启用' : '已禁用'}
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <div>间隔: {job.interval_seconds}s</div>
                    <div>下次: {job.next_run_in}s</div>
                    <div>成功: {job.run_count}</div>
                    <div>失败: {job.error_count}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-800 px-3 py-6 text-sm text-slate-500">
                点击“调度状态”后加载边缘节点本地调度器信息。
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="text-sm font-semibold text-white">本地待执行任务</div>
          <div className="mt-3 space-y-2">
            {scheduledTasks.length ? (
              scheduledTasks.map((task) => (
                <div key={task.task_id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
                  <div className="font-medium text-slate-100">{task.task_id}</div>
                  <div className="mt-1">状态: {task.status}</div>
                  <div className="mt-1">计划时间: {task.scheduled_at}</div>
                  {task.last_error ? <div className="mt-1 text-rose-300">错误: {task.last_error}</div> : null}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-800 px-3 py-6 text-sm text-slate-500">
                当前没有本地排队的定时任务。
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-white">边缘备份管理</div>
          <div className="text-xs text-slate-500">backup / list / dry-run restore / live restore</div>
        </div>
        <div className="mt-3 space-y-2">
          {backups.length ? (
            backups.map((backup) => (
              <div key={backup.path} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-sm font-medium text-slate-100">{backup.name}</div>
                <div className="mt-1 text-xs text-slate-400">
                  size={backup.size} bytes · mtime={new Date(backup.mtime * 1000).toLocaleString('zh-CN', { hour12: false })}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => previewRestore(backup.path)}
                    disabled={!ready}
                    className="rounded-md border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-300 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Dry-run 预览
                  </button>
                  <DangerActionGuard
                    trigger={
                      <button
                        type="button"
                        disabled={!ready}
                        className="rounded-md border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        执行还原
                      </button>
                    }
                    title="执行边缘备份还原"
                    description={`将对备份 ${backup.name} 执行真实还原。建议先完成 Dry-run 预览，避免覆盖当前节点状态。`}
                    confirmText="RESTORE"
                    confirmLabel="确认还原"
                    successMessage="还原指令已发送"
                    onConfirm={async () => {
                      runRestore(backup.path);
                    }}
                    disabled={!ready}
                  />
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-800 px-3 py-6 text-sm text-slate-500">
              当前还没有备份归档。点击“立即备份”或“备份列表”开始。
            </div>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-white">边缘安全巡检</div>
          <div className="text-xs text-slate-500">manual trigger / baseline rebuild / latest reports</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={triggerSecurityAudit}
            disabled={!ready}
            className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            立即巡检
          </button>
          <button
            type="button"
            onClick={() => rebuildSecurityBaseline('credential')}
            disabled={!ready}
            className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            重建凭证基线
          </button>
          <button
            type="button"
            onClick={() => rebuildSecurityBaseline('sop')}
            disabled={!ready}
            className="rounded-md border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-300 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            重建 SOP 基线
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {securityReports.length ? (
            securityReports.map((report, index) => (
              <div key={`${report.timestamp}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-100">{report.node_id}</div>
                  <div className="text-xs text-slate-400">{report.timestamp}</div>
                </div>
                <div className="mt-2 text-xs text-slate-300">
                  crit={report.summary.crit} · warn={report.summary.warn} · ok={report.summary.ok}
                </div>
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/80 p-3 text-xs text-slate-300">
                  {report.report}
                </pre>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-800 px-3 py-6 text-sm text-slate-500">
              当前还没有巡检报告。点击“立即巡检”触发一次手动安全检查。
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
