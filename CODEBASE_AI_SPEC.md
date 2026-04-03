# CODEBASE_AI_SPEC — AI 协作规范

> 本文件供 AI 编码助手阅读。与 [PROJECT_CONTROL_CENTER.md](/F:/openclaw-agent/PROJECT_CONTROL_CENTER.md) 互补：
> - PCC = 项目是什么、进展到哪
> - 本文件 = 代码怎么写、为什么这样写

---

## 一、编码风格规范

### Python (`dragon-senate-saas-v2/`)

- 格式化：`black` + `isort`
- 类型注解：所有公开函数、类方法、dataclass 字段尽量写清类型；新增公共 API 必须有类型注解
- 文档字符串：优先 Google style；模块头部三引号注释至少包含“一句话说明”，如有外部借鉴再补“借鉴来源”
- 命名：变量/函数用 `snake_case`，类用 `PascalCase`，常量用 `UPPER_SNAKE_CASE`
- 异步：I/O 优先 `async/await`；必须走同步库时，用明确的隔离方式，不把阻塞逻辑直接塞进主事件循环
- 导入顺序：stdlib → third-party → local；组间空一行
- 错误处理：对外接口返回可读错误，对内部日志保留上下文；不要吞异常后静默失败
- 用户可见文案：中文优先；标识符、路径、schema key 保持英文

### TypeScript (`packages/` + `src/` + `web/` + `backend/`)

- 格式化：`prettier`
- 类型：默认严格模式；禁止滥用 `any`，仅允许在 API 边界、第三方返回值未定型处短暂使用
- 命名：变量/函数 `camelCase`，类型/接口 `PascalCase`，常量 `UPPER_SNAKE_CASE`
- 文件命名：普通 TS 文件优先 `kebab-case`；Next.js 特殊文件保留 `page.tsx` / `layout.tsx` / `route.ts`
- 导出：优先 named export；默认导出仅保留给 Next.js 页面和框架要求文件
- JSON 配置：新建独立配置文件优先 `snake_case`；如果扩展既有 schema，沿用原 schema 的 key 风格，不强行改名
- 前端文案：运营与控制台文案默认中文；接口字段、内部类型、枚举值保持英文

---

## 二、龙虾命名约定

### canonical_id 规则

- 全小写英文单词，不用空格、不用连字符、不用下划线
- 当前标准值：`commander` / `radar` / `strategist` / `inkwriter` / `visualizer` / `dispatcher` / `echoer` / `catcher` / `abacus` / `followup`

### 文件与目录规则

- Python 运行时模块：`dragon-senate-saas-v2/lobsters/{canonical_id}.py`
- TS 设计时目录：`packages/lobsters/lobster-{canonical_id}/`
- role-card：`packages/lobsters/lobster-{canonical_id}/role-card.json`
- SOUL：`packages/lobsters/lobster-{canonical_id}/SOUL.md`
- AGENTS：`packages/lobsters/lobster-{canonical_id}/AGENTS.md`
- Heartbeat：`packages/lobsters/lobster-{canonical_id}/heartbeat.json`
- Working：`packages/lobsters/lobster-{canonical_id}/working.json`
- Prompt 资产：`packages/lobsters/lobster-{canonical_id}/prompts/`
- 测试文件：`dragon-senate-saas-v2/tests/test_{module_name}.py`

### 技能 ID 规则

- 格式：`{canonical_id}_{skill_verb}_{object}`
- 示例：`radar_web_search`、`inkwriter_copy_generate`、`echoer_reply_generate`
- 统一全小写，下划线分隔

### Prompt 模板 ID 规则

- 格式：`{canonical_id}.{platform}.{scene}.v{version}`
- 示例：`inkwriter.xiaohongshu.product-review.v1`

---

## 三、架构决策记录（ADR）

> ADR 编号追加不重排。发生架构层决策变化时，先改代码，再同步更新本节。

### ADR-001：TS = 设计时真相源，Python = 运行时执行引擎

- 决策：`packages/lobsters/`、`src/agent/commander/` 承载角色卡、工作流、行业配置；Python 运行时负责读取和执行
- 原因：前端与产品配置修改不应依赖 Python 硬编码
- 影响：新增龙虾或行业模板时，先补 TS/JSON 设计时资产，再接 Python 读取链路

### ADR-002：Commander 不替龙虾干活

- 决策：Commander 只做编排、路由、仲裁、异常处理，不直接承担业务产出
- 原因：避免总脑变成单点瓶颈，保持 9 只龙虾各自专业化
- 影响：业务生成逻辑放在具体龙虾或技能，不放在 Commander 主图里

### ADR-003：HITL 默认

- 决策：发布、私信、线索推进等关键动作默认经过人类审批或可被人工接管
- 原因：品牌安全和 SaaS 合规优先于自动化速度
- 影响：审批门、风险判断和回滚链路属于主链，不是可选插件

### ADR-004：边缘只执行，不做业务决策

- 决策：`edge-runtime/` 和边缘执行端只执行云端下发动作，不在本地解释业务语义
- 原因：降低泄漏风险，保证审计与策略统一收敛在云端
- 影响：边缘端不应自行调用 LLM，也不应在本地重写营销策略

### ADR-005：审计优先于性能

- 决策：关键 LLM 调用、审批、分发、回写必须有审计记录
- 原因：回溯、纠错、客户复盘和合规都依赖可追溯链路
- 影响：`audit_logger.py`、`lobster_event_bus.py`、相关 trace 记录是必经路径

### ADR-006：Provider 可插拔

- 决策：模型提供方通过 `provider_registry.py` / 路由层管理，不在龙虾模块里直连 SDK
- 原因：租户可能选择 OpenAI、Claude、国产模型或私有部署
- 影响：任何新模型接入优先走 Provider 抽象，不要把 SDK 调用散落到业务代码

### ADR-007：技能可插拔

- 决策：技能统一在 `lobster_skill_registry.py` 注册，并可在运行时启停
- 原因：客户能力包不同，技能需要独立演进和灰度启用
- 影响：新增技能先注册 `LobsterSkill`，再让龙虾引用，不要把技能逻辑埋进单个类里

### ADR-008：Prompt 是一等资产

- 决策：Prompt 模板存于 `.prompt.md` 与 `prompt-catalog.json`，由 `prompt_asset_loader.py` 加载
- 原因：Prompt 需要版本管理、变体管理、行业适配和 A/B 测试
- 影响：Python 中已有硬编码 Prompt 可以兼容，但新能力优先走 Prompt 资产库

### ADR-009：策略强度分级治理

- 决策：使用 4 级策略强度（观察 / 试探 / 主攻 / 极限）控制资源上限与审批要求
- 原因：不同业务阶段的风险偏好不同，不能所有任务一刀切
- 影响：`packages/lobsters/strategy-intensity-framework.json` 是强度语义真相源，运行时只读取和执行

### ADR-010：WSS 指令 + Webhook 回报 双通道

- 决策：边缘侧通过 WebSocket 长连接接收实时指令，通过 Webhook/事件回报异步结果
- 原因：实时控制和异步回传的链路诉求不同
- 影响：`ws_connection_manager.py` 与 `lobster_webhook.py` 是双通道基座，新增边缘流程不要单边实现

### ADR-011：Agent OS 文件体系显式化

- 决策：每只龙虾在设计时目录下显式维护 `SOUL.md`、`AGENTS.md`、`heartbeat.json`、`working.json`
- 原因：身份、规则、状态不能只散落在代码里
- 影响：新增龙虾时，这四类文件属于标准配套，不是后补资料

---

## 四、禁止操作清单（Don't List）

1. 不要在 Python 代码里新增硬编码 Prompt 字符串，优先走 `prompt_asset_loader.py`
2. 不要在龙虾模块里直接调用具体 LLM SDK，统一走 Provider 抽象
3. 不要把业务生成逻辑塞进 Commander
4. 不要在边缘执行端加入自主业务决策或本地 LLM
5. 不要跳过审计链路记录关键动作
6. 不要在 API 返回、日志或前端状态中暴露 `api_key`、`secret`、`token`
7. 不要在 TS 代码中用 `any` 逃避建模，除非明确处于边界层
8. 不要创建新的龙虾目录却缺少 `role-card.json`
9. 不要跨租户混用状态、缓存、审批数据或资源计数
10. 不要无迁移说明地修改既有 JSON schema key 风格或 API 形状

---

## 五、文件创建检查清单

### 创建新龙虾时必须包含

- [ ] `packages/lobsters/lobster-{id}/role-card.json`
- [ ] `packages/lobsters/lobster-{id}/SOUL.md`
- [ ] `packages/lobsters/lobster-{id}/AGENTS.md`
- [ ] `packages/lobsters/lobster-{id}/heartbeat.json`
- [ ] `packages/lobsters/lobster-{id}/working.json`
- [ ] `packages/lobsters/lobster-{id}/package.json`
- [ ] `packages/lobsters/lobster-{id}/prompts/prompt-catalog.json`
- [ ] `dragon-senate-saas-v2/lobsters/{id}.py`
- [ ] `dragon-senate-saas-v2/tests/test_{id}.py`
- [ ] 在 `dragon-senate-saas-v2/lobster_skill_registry.py` 中注册该龙虾技能
- [ ] 在 `packages/lobsters/registry.json` 中增加包注册项

### 创建新技能时必须包含

- [ ] 在 `dragon-senate-saas-v2/lobster_skill_registry.py` 注册 `LobsterSkill`
- [ ] 正确填写 `bound_lobsters`、`category`、`gotchas`、`references`、`scripts`
- [ ] 至少提供 1 个 `.prompt.md` 模板
- [ ] 更新对应龙虾的 `prompts/prompt-catalog.json`
- [ ] 在对应测试文件中增加技能或调用链测试
- [ ] 如果技能会透出到前端详情页，确认 API 序列化字段可用

---

## 六、Git 提交规范

- 格式：`{type}({scope}): {description}`
- 类型：`feat` / `fix` / `refactor` / `docs` / `test` / `chore`
- scope 推荐值：`commander`、`radar`、`strategist`、`inkwriter`、`visualizer`、`dispatcher`、`echoer`、`catcher`、`abacus`、`followup`、`edge`、`saas`、`web`、`api`、`infra`
- 示例：`feat(inkwriter): add xiaohongshu prompt templates`
- 文档、配置、运行时变更跨层联动时，描述里写清“哪一层是主变更点”

---

## 七、测试规范

- 每个新 Python 模块必须有对应 `tests/test_*.py`
- Python 测试使用 `pytest`
- Mock 外部依赖：LLM、外部 API、数据库、消息通道
- 核心模块覆盖率目标：> 80%
- 新增治理逻辑时，至少覆盖“允许 / 阻断 / 降级或审批”三类路径
- 能自动验证就不要只给人工说明；文档类改动除外

---

## 八、前端工程师对齐点

> 前端不要直连 Python AI 子服务；控制台统一通过 `backend/src/ai-subservice/*` 代理到 `/api/v1/ai/*`。

| Python / 设计时变更 | 前端影响 | 需要同步的文件 |
|---|---|---|
| 新增龙虾 | 龙虾列表、详情、选择器 | `packages/lobsters/lobster-*/role-card.json`、`packages/lobsters/registry.json` |
| 新增技能 | 技能详情与技能管理面板 | `dragon-senate-saas-v2/lobster_skill_registry.py`、前端 endpoint 类型 |
| 新增 Prompt 模板 | Prompt 预览、选择、Prompt 管理页 | `prompts/prompt-catalog.json`、技能详情接口 |
| 策略强度变更 | 强度徽章、升降级按钮、资源上限视图 | `packages/lobsters/strategy-intensity-framework.json`、策略页 |
| 新增 API 端点 | backend 代理与 web SDK 都要补 | `dragon-senate-saas-v2/app.py` → `backend/src/ai-subservice/*` → `web/src/services/endpoints/*` |
| 输出格式变更 | 工件渲染与详情页字段映射 | `role-card.json`、artifact renderer |
| 新增审批/治理字段 | 审批页、trace 页、策略页可能受影响 | API response type、页面状态机 |

