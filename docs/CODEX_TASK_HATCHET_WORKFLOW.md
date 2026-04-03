# CODEX TASK: Hatchet 可靠工作流引擎（云端龙虾任务调度升级）
**任务ID**: CODEX-HATCHET-P2-001  
**优先级**: 🟡 P2（中间层：云端龙虾任务从简单队列 → 持久化/可重试工作流）  
**依赖文件**: `dragon-senate-saas-v2/task_queue.py`, `dragon-senate-saas-v2/lobster_runner.py`  
**参考项目**: Hatchet（https://github.com/hatchet-dev/hatchet）  
**预计工期**: 2天

---

## 一、当前痛点

**现状**：`task_queue.py` 是一个简单的内存/Redis 队列：
```python
# 现状：任务提交后，如果服务器宕机，任务丢失
await task_queue.submit({"lobster_id": "inkwriter", "task": "..."})
```

**问题**：
- 云端龙虾任务失败 → 没有自动重试机制
- SaaS 重启后 → 正在执行的任务全部丢失
- 没有任务执行历史（不知道任务卡在哪个龙虾身上）
- 边缘侧发布包下发失败 → 没有持久化重发机制

**Hatchet 解决**（对比 Temporal/BullMQ）：
- **持久化**：任务状态存数据库，重启后自动恢复
- **自动重试**：配置 max_retries，失败自动重试
- **步骤可见**：每个龙虾步骤都有状态（运行/成功/失败）
- **触发器**：支持 Cron、事件触发、手动触发
- **轻量**：比 Temporal 轻，适合我们的体量

---

## 二、核心工作流定义

### 2.1 内容营销全流程工作流

```python
# dragon-senate-saas-v2/workflows/content_campaign_workflow.py（新建）
"""
内容营销工作流（Hatchet 版）

对应架构：
云端龙虾（策略/创作）→ 生成发布包 → 边缘轻量龙虾（发布+采集）→ 云端龙虾（分析）
"""

from hatchet_sdk import Hatchet, Context

hatchet = Hatchet()


@hatchet.workflow(
    name="content-campaign",
    on_events=["campaign:start"],
)
class ContentCampaignWorkflow:
    """内容营销工作流"""
    
    @hatchet.step(timeout="5m", retries=2)
    async def strategy_planning(self, context: Context) -> dict:
        """
        Step 1: 苏丝(strategist) 制定内容策略
        """
        input_data = context.workflow_input()
        
        from .lobster_runner import run_lobster
        result = await run_lobster(
            lobster_id="strategist",
            task="制定内容策略",
            context={
                "brand_info": input_data["brand_info"],
                "target_platform": input_data["platform"],
            }
        )
        
        return {"strategy": result["output"]}
    
    @hatchet.step(parents=["strategy_planning"], timeout="3m", retries=2)
    async def content_creation(self, context: Context) -> dict:
        """
        Step 2: 墨小鸦(inkwriter) 生成文案内容
        """
        strategy = context.step_output("strategy_planning")["strategy"]
        
        from .lobster_runner import run_lobster
        result = await run_lobster(
            lobster_id="inkwriter",
            task="生成内容",
            context={"strategy": strategy},
        )
        
        return {
            "content_draft": result["output"],
            "title": result.get("title"),
            "hashtags": result.get("hashtags", []),
        }
    
    @hatchet.step(parents=["content_creation"], timeout="2m", retries=1)
    async def visual_generation(self, context: Context) -> dict:
        """
        Step 3: 影子(visualizer) 生成视觉素材
        """
        content = context.step_output("content_creation")
        
        from .lobster_runner import run_lobster
        result = await run_lobster(
            lobster_id="visualizer",
            task="生成配图",
            context={"content": content["content_draft"]},
        )
        
        return {"image_urls": result.get("image_urls", [])}
    
    @hatchet.step(parents=["content_creation", "visual_generation"], timeout="1m", retries=3)
    async def package_and_dispatch(self, context: Context) -> dict:
        """
        Step 4: 老建(dispatcher) 打包并下发给边缘轻量龙虾
        
        ⚠️ 关键步骤：生成"内容发布包"，通过 WSS 发给边缘轻量龙虾执行
        """
        content = context.step_output("content_creation")
        visuals = context.step_output("visual_generation")
        input_data = context.workflow_input()
        
        # 构建发布包（边缘轻量龙虾将执行实际发布）
        publish_packet = {
            "packet_id": f"pkg-{context.workflow_run_id}",
            "tenant_id": input_data["tenant_id"],
            "account_id": input_data["account_id"],
            "platform": input_data["platform"],
            "action": "post",
            "content": {
                "title": content.get("title"),
                "body": content["content_draft"],
                "images": visuals["image_urls"],
                "hashtags": content.get("hashtags", []),
            },
            "created_by_lobster": "dispatcher",
        }
        
        # 通过 WSS 下发给边缘节点
        from .bridge_protocol import dispatch_to_edge
        await dispatch_to_edge(
            tenant_id=input_data["tenant_id"],
            account_id=input_data["account_id"],
            packet=publish_packet,
        )
        
        return {"dispatch_status": "sent", "packet_id": publish_packet["packet_id"]}
    
    @hatchet.step(parents=["package_and_dispatch"], timeout="30m", retries=0)
    async def wait_for_publish_result(self, context: Context) -> dict:
        """
        Step 5: 等待边缘轻量龙虾回报发布结果
        （通过 Hatchet 信号机制接收边缘回调）
        """
        dispatch = context.step_output("package_and_dispatch")
        
        # 等待边缘发回结果（超时30分钟）
        result = await context.wait_for_signal(
            signal_name=f"publish_result:{dispatch['packet_id']}",
            timeout="30m",
        )
        
        return {"publish_result": result}


@hatchet.workflow(
    name="monitor-and-reply",
    on_events=["edge:monitor_data_received"],
)
class MonitorAndReplyWorkflow:
    """
    边缘监控数据处理工作流
    
    触发：边缘轻量龙虾上报评论/私信时自动触发
    """
    
    @hatchet.step(timeout="3m", retries=2)
    async def analyze_data(self, context: Context) -> dict:
        """
        Step 1: 根据数据类型路由给对应云端龙虾分析
        """
        input_data = context.workflow_input()
        data_type = input_data["data_type"]
        
        # 路由到对应龙虾
        lobster_map = {
            "comments": ("echoer", "分析评论情感并生成回复策略"),
            "dm_messages": ("followup", "分析私信需求并生成跟进方案"),
            "post_stats": ("abacus", "分析帖子数据并生成报告"),
        }
        
        lobster_id, task = lobster_map.get(data_type, ("commander", "处理数据"))
        
        from .lobster_runner import run_lobster
        result = await run_lobster(
            lobster_id=lobster_id,
            task=task,
            context={"data": input_data["data"]},
        )
        
        return {
            "analysis": result["output"],
            "reply_actions": result.get("reply_actions", []),  # 需要回复的动作列表
        }
    
    @hatchet.step(parents=["analyze_data"], timeout="2m", retries=3)
    async def dispatch_reply_packets(self, context: Context) -> dict:
        """
        Step 2: 将回复动作打包下发给边缘轻量龙虾执行
        """
        analysis = context.step_output("analyze_data")
        input_data = context.workflow_input()
        
        dispatched = []
        for action in analysis.get("reply_actions", []):
            packet = {
                "packet_id": f"reply-{context.workflow_run_id}-{action['id']}",
                "tenant_id": input_data["tenant_id"],
                "account_id": input_data["account_id"],
                "platform": input_data["platform"],
                "action": action["type"],  # "reply" | "dm"
                "content": action["content"],
                "created_by_lobster": "echoer",
            }
            
            from .bridge_protocol import dispatch_to_edge
            await dispatch_to_edge(
                tenant_id=input_data["tenant_id"],
                account_id=input_data["account_id"],
                packet=packet,
            )
            dispatched.append(packet["packet_id"])
        
        return {"dispatched_packets": dispatched}
```

### 2.2 触发器注册

```python
# dragon-senate-saas-v2/hatchet_setup.py（新建）
"""
Hatchet 初始化和工作流注册
"""

from hatchet_sdk import Hatchet
from .workflows.content_campaign_workflow import ContentCampaignWorkflow, MonitorAndReplyWorkflow

def create_hatchet_worker():
    hatchet = Hatchet()
    
    # 注册工作流
    worker = hatchet.worker(
        name="openclaw-worker",
        max_runs=10,  # 最多同时10个工作流
    )
    
    worker.register_workflow(ContentCampaignWorkflow())
    worker.register_workflow(MonitorAndReplyWorkflow())
    
    return worker


# 在 FastAPI 启动时启动 worker
async def startup_hatchet():
    worker = create_hatchet_worker()
    await worker.async_start()
```

### 2.3 边缘数据触发工作流

```python
# dragon-senate-saas-v2/edge_data_processor.py — 升级版
"""
边缘数据接收器 → 触发 Hatchet 工作流
"""

from hatchet_sdk import Hatchet

hatchet = Hatchet()

async def process_monitor_packet(raw_packet: dict):
    """边缘上报 → 触发 Hatchet 监控分析工作流"""
    
    # 触发 Hatchet 工作流（持久化、可重试）
    await hatchet.event.push(
        event_name="edge:monitor_data_received",
        payload={
            "tenant_id": raw_packet["tenant_id"],
            "account_id": raw_packet["account_id"],
            "platform": raw_packet["platform"],
            "data_type": raw_packet["data_type"],
            "data": raw_packet["data"],
        }
    )
```

---

## 三、验收标准

- [ ] `ContentCampaignWorkflow` 5个步骤按顺序执行（策略→创作→视觉→打包→等待结果）
- [ ] Step 失败后自动重试（配置 retries=2/3）
- [ ] SaaS 重启后工作流从断点恢复（不丢失）
- [ ] `wait_for_signal` 正确接收边缘发回的发布结果
- [ ] `MonitorAndReplyWorkflow` 由边缘监控数据自动触发
- [ ] Hatchet UI 可看到每个工作流的步骤状态
- [ ] 与 `bridge_protocol.py` 集成：dispatch_to_edge 正确发包给边缘轻量龙虾
