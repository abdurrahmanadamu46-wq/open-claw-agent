# 边缘轻量龙虾架构规范（权威定稿）
**文档版本**: v1.0  
**生效日期**: 2026-04-02  
**状态**: 🔴 必须遵守 — 所有边缘层设计以此为准

---

## 一、核心架构设定

```
┌─────────────────────────────────────────────────┐
│              云端龙虾参谋部（SaaS）               │
│  陈总/苏丝/墨小鸦/林涛/影子/算无遗策 等          │
│  - 策略制定、内容生产、数据分析                   │
│  - 生成"内容发布包" → 下发给边缘层               │
│  - 接收边缘层上报的"监控数据包" → 分析处理        │
└───────────────────┬─────────────────────────────┘
                    │ WebSocket 双向隧道
                    │ (WSS 加密 / 心跳保活)
┌───────────────────┴─────────────────────────────┐
│              边缘节点（客户部署）                  │
│  ┌─────────────────────────────────────────┐    │
│  │     轻量龙虾（Edge Lite Lobster）         │    │
│  │  - 无 LLM 推理能力（轻量！）              │    │
│  │  - 只执行云端下发的指令包                 │    │
│  │  - 浏览器操作（发布内容/回复评论）         │    │
│  │  - 采集账号数据（评论/私信/数据）          │    │
│  │  - 打包上报给云端龙虾                     │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  边缘节点持有：客户平台账号Cookie/Token           │
│  （账号凭证永远不上传云端，数据隐私保障）          │
└─────────────────────────────────────────────────┘
```

---

## 二、轻量龙虾 vs 云端龙虾 — 职责对比

| 维度 | 云端龙虾（Cloud Lobster） | 边缘轻量龙虾（Edge Lite Lobster） |
|------|------------------------|--------------------------------|
| **LLM** | ✅ 有（Claude/GPT调用） | ❌ 无（纯执行，节约成本） |
| **职责** | 策略/创作/分析/决策 | 执行/采集/上报 |
| **内容生产** | ✅ 生成文案/图片/视频 | ❌ 只负责发布 |
| **数据分析** | ✅ 分析评论情感/舆情 | ❌ 只负责采集和上报 |
| **部署位置** | SaaS 云端服务器 | 客户本地/VPS/国内服务器 |
| **账号凭证** | ❌ 不持有 | ✅ 持有客户账号Cookie |
| **网络要求** | 云端（全球可达） | 需访问国内平台（小红书/抖音/微信） |
| **计算资源** | 高（LLM推理密集） | 低（浏览器自动化为主） |

---

## 三、数据流协议

### 3.1 下行流（云端 → 边缘）：内容发布包

```python
# 云端龙虾生成后，通过 WSS 下发给边缘轻量龙虾

class ContentPublishPacket:
    """内容发布包（云端下发给边缘）"""
    
    packet_id: str          # 全局唯一包ID
    tenant_id: str          # 租户ID
    account_id: str         # 目标账号ID（边缘侧注册）
    platform: str           # "xiaohongshu" | "douyin" | "weixin"
    
    # 发布指令
    action: str             # "post" | "reply" | "dm" | "like" | "collect"
    
    # 内容数据（已由云端龙虾生成完毕）
    content: dict           # 完整的发布内容
    # {
    #   "title": "🌸 这款防晒霜...",
    #   "body": "正文内容...",
    #   "images": ["https://oss.../img1.jpg"],  # OSS图片链接
    #   "hashtags": ["#防晒", "#护肤"],
    #   "target_comment_id": "xxx",  # 如果是回复评论
    # }
    
    # 执行参数
    schedule_time: Optional[datetime]  # 定时发布（None=立即）
    retry_limit: int = 3               # 失败重试次数
    
    # 追踪
    created_by_lobster: str    # "inkwriter" | "echoer" 等
    created_at: datetime
```

### 3.2 上行流（边缘 → 云端）：监控数据包

```python
class MonitorDataPacket:
    """监控数据包（边缘上报给云端）"""
    
    packet_id: str
    tenant_id: str
    account_id: str
    platform: str
    
    # 监控类型
    data_type: str  # "comments" | "dm_messages" | "post_stats" | "fans_change"
    
    # 采集到的原始数据
    data: list[dict]
    # 评论示例：
    # [{
    #   "comment_id": "...",
    #   "author": "用户昵称",
    #   "content": "请问这个怎么用？",
    #   "timestamp": "2026-04-02T14:30:00",
    #   "post_id": "...",
    #   "likes": 3,
    # }]
    
    # 私信示例：
    # [{
    #   "dm_id": "...",
    #   "from_user": "用户昵称",
    #   "content": "在吗，想咨询一下",
    #   "timestamp": "...",
    # }]
    
    # 边缘侧基础处理（不含 LLM 分析）
    basic_stats: dict   # 数量统计、时间范围等
    collected_at: datetime
```

---

## 四、轻量龙虾核心模块

```python
# edge-runtime/edge_lite_lobster.py（新建/重构）
"""
边缘轻量龙虾
- 无 LLM，纯执行层
- 接收云端发布包 → 执行浏览器操作 → 上报结果
- 采集账号数据 → 打包 → 上报云端
"""

class EdgeLiteLobster:
    """
    边缘轻量龙虾
    
    职责：
    1. Publisher（发布者）：接包 → 发布内容到平台
    2. Collector（采集者）：监控账号 → 打包 → 上报
    """
    
    def __init__(self, node_id: str, tenant_id: str):
        self.node_id = node_id
        self.tenant_id = tenant_id
        self.account_registry = {}  # account_id → 账号凭证
        self.wss_client = None      # 与云端的 WSS 连接
    
    # ══════════════════════════════════════════
    # 发布侧（接收云端包 → 执行发布）
    # ══════════════════════════════════════════
    
    async def handle_publish_packet(self, packet: ContentPublishPacket):
        """处理云端下发的发布包"""
        account = self.account_registry.get(packet.account_id)
        if not account:
            await self.report_error(packet.packet_id, "账号未注册")
            return
        
        # 路由到对应平台执行器
        executor = self._get_executor(packet.platform)
        
        try:
            if packet.action == "post":
                result = await executor.publish_post(account, packet.content)
            elif packet.action == "reply":
                result = await executor.reply_comment(
                    account, 
                    packet.content["target_comment_id"],
                    packet.content["body"],
                )
            elif packet.action == "dm":
                result = await executor.send_dm(
                    account,
                    packet.content["to_user"],
                    packet.content["body"],
                )
            
            # 上报执行结果
            await self.report_publish_result(packet.packet_id, result)
            
        except Exception as e:
            await self.report_error(packet.packet_id, str(e))
            if packet.retry_limit > 0:
                await self.schedule_retry(packet)
    
    # ══════════════════════════════════════════
    # 采集侧（监控账号 → 上报云端）
    # ══════════════════════════════════════════
    
    async def collect_and_report(self, account_id: str):
        """采集账号数据并上报给云端龙虾"""
        account = self.account_registry.get(account_id)
        executor = self._get_executor(account.platform)
        
        # 采集评论
        new_comments = await executor.fetch_new_comments(account)
        
        # 采集私信
        new_dms = await executor.fetch_new_dms(account)
        
        # 采集账号数据（粉丝/互动）
        stats = await executor.fetch_account_stats(account)
        
        # 打包上报（不做分析！分析是云端龙虾的活）
        if new_comments:
            await self.upload_monitor_data(MonitorDataPacket(
                account_id=account_id,
                data_type="comments",
                data=new_comments,
            ))
        
        if new_dms:
            await self.upload_monitor_data(MonitorDataPacket(
                account_id=account_id,
                data_type="dm_messages",
                data=new_dms,
            ))
    
    def _get_executor(self, platform: str):
        """获取平台执行器（Camoufox 反检测浏览器）"""
        from .marionette_executor import MarionetteExecutor
        return MarionetteExecutor(platform=platform)
```

---

## 五、云端龙虾如何接收边缘数据

```python
# dragon-senate-saas-v2/edge_data_processor.py（新建）
"""
云端边缘数据处理器
- 接收边缘上报的监控数据包
- 分发给对应的云端龙虾处理
"""

async def process_monitor_packet(packet: MonitorDataPacket):
    """处理边缘上报的监控数据"""
    
    if packet.data_type == "comments":
        # 评论 → 交给阿声(echoer) 分析情感、生成回复策略
        await route_to_lobster("echoer", {
            "task": "analyze_comments",
            "account_id": packet.account_id,
            "comments": packet.data,
        })
    
    elif packet.data_type == "dm_messages":
        # 私信 → 交给小锤(followup) 分析需求、生成跟进策略
        await route_to_lobster("followup", {
            "task": "analyze_dms",
            "account_id": packet.account_id,
            "messages": packet.data,
        })
    
    # 云端龙虾分析完 → 生成回复内容 → 打包下发给边缘执行
```

---

## 六、架构安全原则

1. **账号凭证不出边缘**：客户的平台 Cookie/Token 只存在边缘节点，永不上传云端
2. **云端只传内容**：云端龙虾只发内容数据（文字/图片），不发账号凭证
3. **边缘不做决策**：边缘轻量龙虾无 LLM，不做任何内容判断，只执行指令
4. **双向加密**：WSS 连接 TLS 加密，包含 tenant_id + HMAC 签名防篡改
5. **本地日志审计**：边缘节点保留完整操作日志，可由客户自行审查

---

## 七、影响的 Codex Task（需按此架构调整）

| Task | 调整内容 |
|------|---------|
| `CODEX_TASK_STAGEHAND_MARIONETTE.md` | 明确：Marionette 是轻量龙虾的执行引擎，只执行云端下发的指令，不含 LLM |
| `CODEX_TASK_BROWSER_USE_CAMOUFOX.md` | 明确：Camoufox 用于轻量龙虾的反检测发布和监控采集 |
| `CODEX_TASK_COMPOSIO_TOOLS.md` | 调整：Composio 工具是云端龙虾的能力，不是边缘轻量龙虾 |
| `CODEX_TASK_APSCHEDULER_EDGE_OFFLINE.md` | 补充：离线时轻量龙虾缓存包，恢复连接后自动执行 |
| `CODEX_TASK_VALKEY_EDGE_REGISTRY.md` | 补充：注册信息包含账号列表（不含凭证）和轻量龙虾版本 |
| `CODEX_TASK_LANGGRAPH_BRAIN.md` | 补充：LangGraph 图的 Dispatcher 节点负责生成"发布包"下发边缘 |
