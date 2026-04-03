# pkgx Codex 任务索引
> 来源：https://github.com/pkgxdev/pkgx
> 分析日期：2026-04-02
> 定性：Rust 包管理器/运行时，"run anything" 哲学，借鉴其依赖解析/幂等锁/上下文注入/CI 边界检查

| 任务ID | 文件 | 状态 | 说明 |
|--------|------|------|------|
| PKGX-P1-1 | `CODEX_TASK_PKGX_P1.md` §P1-1 | ✅ 已落地 | 龙虾任务幂等执行锁（`task_idempotency_lock.py`）防并发重复 |
| PKGX-P1-2 | `CODEX_TASK_PKGX_P1.md` §P1-2 | ✅ 已落地 | Resolution 三段任务状态（`task_resolution.py`）required/satisfied/pending |
| PKGX-P1-3 | `CODEX_TASK_PKGX_P1.md` §P1-3 | 🆕 待落地 | 龙虾执行上下文零泄漏沙箱（`lobster_context_injector.py`）ContextVar 隔离 |
| PKGX-P1-4 | `CODEX_TASK_PKGX_P1.md` §P1-4 | 🆕 待落地 | Agent 行为边界 CI 自动校验（`scripts/agent_boundary_check.py`）|
| PKGX-P1-5 | `CODEX_TASK_PKGX_P1.md` §P1-5 | 🆕 待落地 | Provider 语义版本约束路由（`provider_version_selector.py`）|
| PKGX-P2-1 | 待创建 | 📋 规划中 | 边缘技能 DB 增量同步（`edge-runtime/skill_db_sync.py`）本地 SQLite 缓存 |
| PKGX-P2-2 | 待创建 | 📋 规划中 | 边缘节点多 OS Docker 镜像矩阵（debian/ubuntu/alpine）|
| PKGX-P2-3 | 待创建 | 📋 规划中 | 龙虾技能 Pantry YAML 规范升级（`SKILL_PANTRY_SPEC.md`）|
| PKGX-P3-1 | 待创建 | 📋 规划中 | 边缘任务进度终端 Spinner 输出（`edge-runtime/task_spinner.py`）|

## 当前进度

- 已完成：`PKGX-P1-1` 任务幂等执行锁
- 已完成：`PKGX-P1-2` Resolution 三段任务状态
- 待推进：`PKGX-P1-3` 上下文零泄漏沙箱
- 待推进：`PKGX-P1-4` Agent 行为边界 CI 校验
- 待推进：`PKGX-P1-5` Provider 语义版本约束路由

## 核心借鉴点速查

| pkgx 模块 | 借鉴到我们的 | 价值 |
|----------|------------|------|
| `resolve.rs` Resolution 三段结构 | `task_resolution.py` | 避免重复执行已完成子任务 |
| `install.rs` fs2 文件锁 | `task_idempotency_lock.py` | 防并发重复执行，节省成本 |
| `execve.rs` 环境注入 | `lobster_context_injector.py` | 跨租户上下文零泄漏 |
| `inventory.rs` 语义版本过滤 | `provider_version_selector.py` | LLM Provider 智能路由 |
| `agent-boundary-check.yml` | `scripts/agent_boundary_check.py` | CI 自动校验 agent 行为边界 |
| `sync.rs` 增量同步 + `pantry_db.rs` SQLite | `edge-runtime/skill_db_sync.py` | 边缘离线可用 |

## 已有/略过

| pkgx 特性 | 略过原因 |
|----------|---------|
| 并发安装 FuturesUnordered | `batch_task_tracker.py` 已覆盖 |
| HTTP CA 证书 | `ssrf_guard.py` 更完整 |
| AGENTS.md | 我们已有且更完整 |
| Cargo 生态 | Python 项目不适用 |

*更新：2026-04-02（按当前仓库真实状态同步）*
