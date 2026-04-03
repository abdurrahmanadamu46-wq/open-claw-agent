# WSS Protocol Standardization (Historical Note)

> 状态：历史任务草案，已不再作为当前仓库的权威接口说明  
> 请改看：
> - `C:\Users\Administrator\Desktop\openclaw-agent\docs\CODEX_TASK_DEDUP_CLEANUP.md`
> - [PROJECT_CONTROL_CENTER.md](/F:/openclaw-agent/PROJECT_CONTROL_CENTER.md)
> - [SYSTEM_ARCHITECTURE_OVERVIEW.md](/F:/openclaw-agent/docs/SYSTEM_ARCHITECTURE_OVERVIEW.md)

这份文档对应的是更早期的 `wss_receiver.py` 标准化设想，当前仓库已经演进为：

- `node_ping` 是唯一心跳事件
- 终端、调度、备份都复用现有 edge/fleet socket 主链
- 浏览器层通过 `/edge-terminal` 命名空间访问终端、调度、备份能力

因此，这份文档仅保留为历史背景，不再作为前后端开发或联调的依据。
