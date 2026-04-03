# Edge Runtime Client Architecture

## Purpose

`edge-runtime/` is the executor-only client that runs on edge nodes.
It receives cloud commands, performs browser or local actions, keeps local memory,
and reports results back to the control plane. It does not make business decisions.

## Current Modules

| Module | File | Responsibility | Status |
| --- | --- | --- | --- |
| Fleet Client | `wss_receiver.py` | Socket.IO client, cloud relay, terminal/backup/scheduler message handling | ✅ |
| Local Scheduler | `edge_scheduler.py` | Offline-capable background jobs | ✅ |
| Scheduler Jobs | `jobs/` | `memory_sync`, `log_cleanup`, `task_check` | ✅ |
| Backup Manager | `backup_manager.py` | Backup / restore / migration with manifest and restore marker | ✅ |
| Terminal Bridge | `terminal_bridge.py` | Safe debug commands and log following | ✅ |
| Context Navigator | `context_navigator.py` | Selector/target resolution | ✅ |
| Marionette Executor | `marionette_executor.py` | Step-by-step SOP execution | ✅ |
| BBP Kernel | `bbp_kernel.py` | Human-like cursor trajectories | ✅ |
| Memory Store | `memory_store.py` | Local SQLite memory and scheduled task persistence | ✅ |
| Memory Consolidator | `memory_consolidator.py` | Lightweight memory summarization | ✅ |
| Event Watcher | `event_watcher.py` | Local event monitoring | ✅ |
| Event Reporter | `event_reporter.py` | Event uplink to cloud | ✅ |

## Runtime Flow

```text
client_main.py
  -> WSSReceiver.connect()
  -> EdgeScheduler.start()
  -> wait for cloud task / terminal / backup / scheduler messages
  -> MarionetteExecutor / TerminalBridge / BackupManager / MemoryStore
  -> report result via fleet socket
```

## Canonical Edge Messages

### Cloud to Edge
- `execute_task`
- `server.task.dispatch` (legacy compatibility)
- `execute_behavior_session`
- `terminal_start`
- `terminal_command`
- `terminal_stop`
- `scheduler_status_request`
- `scheduler_toggle_request`
- `backup_trigger`
- `backup_list`
- `backup_restore`

### Edge to Cloud
- `node_ping`
- `task_progress`
- `task_completed`
- `terminal_output`
- `terminal_error`
- `terminal_closed`
- `scheduler_status_response`
- `scheduler_toggle_response`
- `backup_complete`
- `backup_list_response`
- `backup_restore_response`
- `restore_complete_report`
- `edge_memory_sync_batch`

## Offline Guarantees

- Native `node_ping` is the only heartbeat path.
- Future-scheduled tasks are persisted locally and can still run while disconnected.
- Memory sync retries later if cloud is unavailable.
- Backups and restores operate on local edge state and do not require cloud connectivity.
