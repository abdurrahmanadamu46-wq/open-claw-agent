# CODEX-OCM-03: role-card.json 安全增强 — 沙箱/权限/子代理

> ⚠️ **整合提示**: 本任务中的 `sandboxMode` / `toolsAllow` / `toolsDeny` / `maxConcurrency` 字段已合入 **CODEX-AA-01** (`docs/CODEX_TASK_LOBSTER_SOUL_SYSTEM.md`)。
> 本任务中独有的 `subagentAllow` / `mentionPatterns` / `SecurityGuardHook` 仍有效，实施时以 CODEX-AA-01 为主、本文件为补充。

> **优先级**: P1 | **算力**: 低 | **来源**: OpenClaw Manager 借鉴分析
> **分析文档**: `docs/OPENCLAW_MANAGER_BORROWING_ANALYSIS.md`

---

## 背景

OpenClaw Manager 的 Agent 配置包含 `sandboxMode`（沙箱模式）、`toolsAllow/toolsDeny`（工具白/黑名单）、`subagentAllow`（子代理权限）等安全相关字段，实现了精细的 Agent 权限控制。

我们当前 `packages/lobsters/lobster-*/role-card.json` 仅有身份描述字段（persona / decision_style 等），缺少安全控制维度。随着龙虾系统走向 SaaS 多租户，权限隔离变得关键。

## 目标

在每虾的 `role-card.json` 中增加安全控制字段，并在 `lobster_runner.py` 中增加对应的前置校验。

## 交付物

### 1. 扩展 `role-card.json` Schema

在 `packages/lobsters/lobster-*/role-card.json` 中新增以下字段：

```jsonc
{
  // ... 已有字段 (id, name, persona, decision_style, blind_spots, forbidden_actions)
  
  // ====== 新增安全控制字段 ======
  
  // 沙箱模式: "off" | "non-main" | "all"
  // off = 完全访问, non-main = 仅子任务沙箱, all = 所有任务沙箱化
  "sandboxMode": "non-main",
  
  // 允许使用的工具列表（空数组 = 全部允许）
  "toolsAllow": ["search", "analyze", "generate", "score"],
  
  // 禁止使用的工具列表
  "toolsDeny": ["exec", "delete", "admin"],
  
  // 允许调用的其他龙虾 ID 列表（"*" = 全部, 空数组 = 不允许调用）
  "subagentAllow": ["echoer", "catcher"],
  
  // @提及匹配模式（用于消息路由）
  "mentionPatterns": ["@radar", "@触须虾"],
  
  // 最大并发分身数
  "maxConcurrency": 5
}
```

### 2. 为每只龙虾填入合理默认值

| 龙虾 | sandboxMode | toolsAllow | toolsDeny | subagentAllow | maxConcurrency |
|------|-------------|-----------|-----------|---------------|----------------|
| radar 触须虾 | off | ["search", "analyze"] | ["exec", "delete"] | ["strategist"] | 5 |
| strategist 脑虫虾 | off | ["analyze", "plan", "generate"] | ["exec"] | ["*"] | 3 |
| inkwriter 吐墨虾 | non-main | ["generate", "search"] | ["exec", "delete", "admin"] | [] | 5 |
| visualizer 幻影虾 | non-main | ["generate", "image"] | ["exec", "delete"] | [] | 3 |
| dispatcher 点兵虾 | off | ["plan", "dispatch", "query"] | ["generate"] | ["*"] | 2 |
| echoer 回声虾 | all | ["generate", "search"] | ["exec", "delete", "admin"] | [] | 10 |
| catcher 铁网虾 | non-main | ["score", "analyze", "query"] | ["exec", "generate"] | ["abacus"] | 5 |
| abacus 金算虾 | non-main | ["score", "calc", "query"] | ["exec", "generate"] | [] | 3 |
| followup 回访虾 | all | ["generate", "query", "schedule"] | ["exec", "delete"] | ["echoer"] | 5 |

### 3. `dragon-senate-saas-v2/lobster_runner.py` 增加前置校验

在 `LobsterRunner.run()` 方法中，新增一个 `SecurityGuardHook`：

```python
class SecurityGuardHook(LobsterHook):
    """安全守卫 Hook — 校验 role-card 中的安全约束"""
    
    def before_run(self, context: dict) -> dict:
        role_card = context.get("role_card", {})
        
        # 1. 检查沙箱模式
        sandbox = role_card.get("sandboxMode", "off")
        if sandbox == "all":
            context["sandboxed"] = True
        
        # 2. 检查工具权限
        tools_allow = role_card.get("toolsAllow", [])
        tools_deny = role_card.get("toolsDeny", [])
        requested_tools = context.get("requested_tools", [])
        
        for tool in requested_tools:
            if tools_deny and tool in tools_deny:
                raise PermissionError(f"工具 '{tool}' 被 role-card 禁止")
            if tools_allow and tool not in tools_allow:
                raise PermissionError(f"工具 '{tool}' 不在 role-card 允许列表中")
        
        # 3. 检查子代理权限
        target_lobster = context.get("target_lobster")
        subagent_allow = role_card.get("subagentAllow", [])
        if target_lobster and subagent_allow != ["*"]:
            if target_lobster not in subagent_allow:
                raise PermissionError(f"不允许调用龙虾 '{target_lobster}'")
        
        # 4. 检查并发限制
        max_conc = role_card.get("maxConcurrency", 10)
        current_conc = context.get("current_concurrency", 0)
        if current_conc >= max_conc:
            context["queued"] = True  # 入队等待，不拒绝
        
        return context
```

### 4. 测试文件

`dragon-senate-saas-v2/tests/test_security_guard_hook.py` 覆盖：
- 工具白名单通过/拒绝
- 工具黑名单通过/拒绝
- 子代理权限检查
- 并发限制队列行为
- 沙箱标记注入

## 约束

- role-card.json 新字段全部 **可选**，缺失时使用安全的默认值
- 不破坏现有 `lobster_runner.py` 的执行流
- `SecurityGuardHook` 通过 `CompositeHook` 注入，可选启用
- 错误以 `PermissionError` 抛出，由 LobsterRunner 统一捕获并记录审计日志

## 验收标准

1. 所有 9 个 `role-card.json` 已更新新字段
2. `SecurityGuardHook` 测试全部通过
3. `python -m pytest dragon-senate-saas-v2/tests/test_security_guard_hook.py` 绿色
4. 现有 `test_lobster_runner.py` 不受影响（向后兼容）
