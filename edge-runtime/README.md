# Edge Runtime

`edge-runtime/` is the edge executor for OpenClaw Agent.
It runs on customer machines or edge nodes and is responsible for:

- receiving cloud commands over the fleet socket
- executing SOP packets locally
- storing local memory and scheduled tasks
- exposing a safe debug terminal
- supporting local backup / restore

## Main Entry

- [client_main.py](/F:/openclaw-agent/edge-runtime/client_main.py)

## Key Components

- [wss_receiver.py](/F:/openclaw-agent/edge-runtime/wss_receiver.py)
- [edge_scheduler.py](/F:/openclaw-agent/edge-runtime/edge_scheduler.py)
- [backup_manager.py](/F:/openclaw-agent/edge-runtime/backup_manager.py)
- [terminal_bridge.py](/F:/openclaw-agent/edge-runtime/terminal_bridge.py)
- [memory_store.py](/F:/openclaw-agent/edge-runtime/memory_store.py)
- [marionette_executor.py](/F:/openclaw-agent/edge-runtime/marionette_executor.py)

## Operations

### Backup

```bash
bash edge-runtime/scripts/backup.sh
```

### Restore Preview

```bash
bash edge-runtime/scripts/restore.sh /path/to/archive.tar.gz --dry-run
```

### Restore

```bash
bash edge-runtime/scripts/restore.sh /path/to/archive.tar.gz
```

## Notes

- Edge runtime is executor-only. It does not perform business reasoning.
- `node_ping` is the canonical heartbeat event.
- Backup / restore and scheduler state both live under `~/.openclaw`.
