# CODEX TASK: Open WebUI 借鉴 P2 合并任务包

**优先级：P2**  
**来源：OPENWEBUI_BORROWING_ANALYSIS.md P2-1 ～ P2-7**  
**借鉴自**：Open WebUI ⭐129.6k

---

## P2-1: 龙虾知识库管理 UI（KnowledgeBaseUI）

**对应 Open WebUI**：`routers/knowledge.py` + `components/workspace/`  
**落地路径**：前端 `/operations/knowledge-base` 页面 + `dragon-senate-saas-v2/knowledge_base_manager.py`

### 功能说明
- 上传 PDF/Word/TXT/URL → 后端自动分块 → 向量化（接入 Qdrant，`CODEX_TASK_HYBRID_MEMORY_SEARCH.md` 已落地）
- 知识库列表：名称/文档数/创建时间/绑定龙虾
- 龙虾绑定：每只龙虾可绑定 1-N 个知识库，任务执行时自动检索注入

```python
# dragon-senate-saas-v2/knowledge_base_manager.py (骨架)
class KnowledgeBase:
    kb_id: str
    name: str
    tenant_id: str
    bound_lobsters: list[str]   # 绑定的龙虾 ID 列表
    doc_count: int
    created_at: datetime

class KnowledgeBaseManager:
    async def create(self, name: str, tenant_id: str) -> KnowledgeBase: ...
    async def upload_doc(self, kb_id: str, file_bytes: bytes, filename: str): ...
    async def search(self, kb_id: str, query: str, top_k: int = 5) -> list[dict]: ...
    async def bind_lobster(self, kb_id: str, lobster_id: str): ...
```

### 验收标准
- [ ] 知识库 CRUD API（增删改查）
- [ ] 文档上传 → 自动分块 → 写入 Qdrant
- [ ] 龙虾绑定知识库后，运行时自动检索注入 prompt
- [ ] 前端 `/operations/knowledge-base` 页面展示知识库列表和文档管理

---

## P2-2: 对话分支树（TaskForkTree）

**对应 Open WebUI**：`components/chat/` 分支 UI  
**落地路径**：前端任务详情页增加"Fork"能力

### 功能说明
龙虾任务可以 Fork：基于同一 prompt 运行多次（不同模型/参数）→ 并排对比输出 → 选优保存

```
任务 A (原始)
├── Fork B → 用 Claude 重跑
├── Fork C → 调整 temperature 重跑
└── 选择最佳 → 标记为 "golden_output"
```

### 验收标准
- [ ] `POST /api/v1/tasks/{task_id}/fork` → 创建 Fork 任务
- [ ] Fork 任务与原始任务关联（`parent_task_id` 字段）
- [ ] 前端支持并排对比两个任务输出
- [ ] 可将某个 Fork 输出标记为 `golden_output`（写入 dataset_store）

---

## P2-3: Prompt 工作区 UI（PromptWorkspaceUI）

**对应 Open WebUI**：`components/workspace/` Prompt 管理  
**落地路径**：前端 `/operations/prompt-workspace`

### 功能说明
- Prompt 模板列表（`prompt_registry.py` 后端已有，此处建前端 UI）
- 变量插槽编辑：`{{brand_name}}` `{{target_audience}}` 可视化填写
- Prompt 版本历史（`CODEX_TASK_PROMPT_DIFF_VIEW.md` 已落地，集成到此页面）
- 一键测试：选龙虾 + 填变量 → 立即运行预览输出

### 验收标准
- [ ] 前端列表展示所有 Prompt 模板（分龙虾/类型筛选）
- [ ] 变量槽可视化编辑（`{{var}}` 高亮+填写区）
- [ ] "测试运行"按钮触发龙虾实时执行
- [ ] 版本历史 diff 视图集成

---

## P2-4: 团队频道（LobsterBroadcastChannel）

**对应 Open WebUI**：`routers/channels.py` + `components/channel/`  
**落地路径**：`dragon-senate-saas-v2/lobster_broadcast_channel.py`

### 功能说明
龙虾产出内容可广播到"频道"（类似 Slack 频道），多个成员订阅 → 收到龙虾播报：
- `inkwriter` 完成文章 → 推送到"内容频道"
- `catcher` 完成线索收集 → 推送到"销售频道"
- `abacus` 完成数据报告 → 推送到"管理层频道"

```python
# 骨架
class LobsterBroadcastChannel:
    channel_id: str
    name: str
    subscribed_lobsters: list[str]
    subscribed_users: list[str]

    async def broadcast(self, lobster_id: str, task_output: dict): ...
    async def subscribe_user(self, user_id: str): ...
```

### 验收标准
- [ ] 频道 CRUD API
- [ ] 龙虾任务完成后触发 `broadcast()`（接入 `lobster_post_task_processor.py`）
- [ ] 前端频道页：实时收到龙虾播报（WebSocket 推送）
- [ ] 用户可订阅/取消订阅频道

---

## P2-5: 资源级访问授权（ResourceAccessGrant）

**对应 Open WebUI**：`models/access_grants.py`  
**落地路径**：`dragon-senate-saas-v2/resource_access_grant.py`

### 功能说明
现有 `rbac_permission.py` 是角色级控制，无法做到"把某个工作流共享给特定用户"。
新增资源级授权：

```python
class ResourceAccessGrant:
    resource_type: Literal["lobster", "workflow", "knowledge_base", "prompt"]
    resource_id: str
    grantee_type: Literal["user", "group"]
    grantee_id: str
    permission: Literal["read", "write", "execute"]
    expires_at: Optional[datetime]
```

### 验收标准
- [ ] `ResourceAccessGrant` 数据模型和 CRUD API
- [ ] 权限检查中间件（`rbac_permission.py` 扩展）
- [ ] 前端"分享"按钮：选用户/组 + 权限级别 + 有效期
- [ ] 访问越权时返回 403

---

## P2-6: 输出公开分享链接（OutputShareLink）

**对应 Open WebUI**：`routes/s/` 分享路由  
**落地路径**：`dragon-senate-saas-v2/output_share_link.py` + 前端 `/share/[token]`

### 功能说明
龙虾任务输出可生成公开分享链接（无需登录即可查看），用于：
- 发给客户展示龙虾产出的文案/报告
- 嵌入到邮件/微信中分享
- 可设置有效期和查看次数限制

```python
class OutputShareLink:
    share_token: str        # 随机 token
    task_id: str
    tenant_id: str
    expires_at: Optional[datetime]
    max_views: Optional[int]
    view_count: int = 0

    @classmethod
    def create(cls, task_id: str, tenant_id: str, ttl_hours: int = 72) -> "OutputShareLink": ...
```

### 验收标准
- [ ] `POST /api/v1/tasks/{task_id}/share` → 生成分享 token
- [ ] `GET /share/{token}` → 公开页面（无需登录，展示 ArtifactRenderer）
- [ ] 超过有效期/查看次数返回 410 Gone
- [ ] 分享页展示龙虾名称、产出时间、输出内容（Artifact 渲染）

---

## P2-7: 自定义 Python 函数沙箱（EdgeFunctionSandbox）

**对应 Open WebUI**：`functions.py` 自定义函数沙箱  
**落地路径**：`edge-runtime/function_sandbox.py`

### 功能说明
允许高级用户/开发者上传 Python 脚本，扩展龙虾的处理能力：
- 自定义数据预处理逻辑（在 prompt 发出前）
- 自定义输出后处理逻辑（在输出返回后格式化）
- 运行在隔离沙箱中（不允许 import 网络/文件系统模块）

```python
# edge-runtime/function_sandbox.py
BLOCKED_IMPORTS = {"os", "sys", "subprocess", "socket", "requests", "urllib"}

class FunctionSandbox:
    def __init__(self, allowed_imports: set = None):
        self.allowed_imports = allowed_imports or {"re", "json", "datetime", "math", "string"}

    def execute(self, code: str, input_data: dict) -> dict:
        """在受限环境中执行用户代码"""
        # 静态分析：检测危险 import
        for mod in BLOCKED_IMPORTS:
            if f"import {mod}" in code or f"from {mod}" in code:
                raise SecurityError(f"禁止导入模块: {mod}")
        # 在受限 globals 中执行
        safe_globals = {"__builtins__": {}, "input": input_data}
        exec(compile(code, "<sandbox>", "exec"), safe_globals)
        return safe_globals.get("output", {})
```

### 验收标准
- [ ] `FunctionSandbox.execute()` 阻止危险模块导入
- [ ] 函数超时限制（5秒）
- [ ] 函数 CRUD API（上传/测试/绑定龙虾）
- [ ] 前端函数管理页：代码编辑器（Monaco）+ 沙箱测试

---

*Codex Task | 来源：OPENWEBUI_BORROWING_ANALYSIS.md P2-1~P2-7 合并 | 2026-04-02*
