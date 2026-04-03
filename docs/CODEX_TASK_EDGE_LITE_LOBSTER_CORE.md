# CODEX TASK: 边缘轻量龙虾核心实现
**任务ID**: CODEX-EDGELITE-P0-001  
**优先级**: 🔴 P0（边缘层核心：轻量龙虾的发布 + 采集 + 上报完整实现）  
**架构依据**: `docs/EDGE_LITE_LOBSTER_ARCHITECTURE.md`（必读！）  
**依赖文件**: `edge-runtime/marionette_executor.py`, `edge-runtime/wss_receiver.py`  
**预计工期**: 3天

---

## 一、核心职责（切记！）

边缘轻量龙虾 **不是** 云端龙虾的缩减版，而是一个**纯执行代理**：

```
云端龙虾（有LLM，做决策）
    │
    │ ① 下发"内容发布包"（文案/图片已生成好）
    ▼
边缘轻量龙虾（无LLM，只执行）
    │
    ├─ ② 用 Camoufox 浏览器发布到客户账号（小红书/抖音）
    ├─ ③ 定时采集评论/私信/数据
    │
    │ ④ 上报"监控数据包"（原始数据，不分析）
    ▼
云端龙虾（接收数据，LLM分析，生成下一步指令）
```

---

## 二、核心文件结构

```
edge-runtime/
├── edge_lite_lobster.py       # 轻量龙虾主类（新建）
├── packet_handler.py          # 包处理：解析/验证/路由（新建）
├── account_vault.py           # 账号凭证本地保险箱（新建）
├── monitor_collector.py       # 监控采集：评论/私信/数据（新建）
├── publish_executor.py        # 发布执行：post/reply/dm（新建，调用marionette）
├── offline_queue.py           # 离线缓存队列（断网时缓存包）（新建）
├── marionette_executor.py     # 已有，升级支持 fetch_new_comments 等采集方法
└── wss_receiver.py            # 已有，升级：区分下行包/上行包
```

---

## 三、核心实现

### 3.1 边缘轻量龙虾主类

```python
# edge-runtime/edge_lite_lobster.py
"""
边缘轻量龙虾（Edge Lite Lobster）
无 LLM，纯执行 + 采集 + 上报

部署：客户本地 / 国内 VPS
功能：
  1. 接收云端"发布包" → 发布内容到平台账号
  2. 定时采集账号数据 → 上报给云端龙虾
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class ContentPublishPacket:
    """云端 → 边缘：内容发布包"""
    packet_id: str
    tenant_id: str
    account_id: str
    platform: str           # "xiaohongshu" | "douyin" | "weixin" | "weibo"
    action: str             # "post" | "reply" | "dm" | "like"
    content: dict           # 已由云端生成好的内容（文字+图片OSS链接）
    schedule_time: Optional[datetime] = None
    retry_limit: int = 3
    created_by_lobster: str = ""  # 哪只云端龙虾生成的
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class MonitorDataPacket:
    """边缘 → 云端：监控数据包"""
    packet_id: str
    tenant_id: str
    account_id: str
    platform: str
    data_type: str          # "comments" | "dm_messages" | "post_stats" | "fans_change"
    data: list              # 原始采集数据（不含分析结果）
    basic_stats: dict       # 基础统计（数量/时间范围）
    collected_at: datetime = field(default_factory=datetime.utcnow)


class EdgeLiteLobster:
    """
    边缘轻量龙虾
    
    ⚠️ 重要原则：
    - 无 LLM 调用（不调用 Claude/GPT）
    - 账号凭证只存本地，永不上传云端
    - 只执行云端指令，不做内容决策
    """
    
    def __init__(self, node_id: str, tenant_id: str, config: dict):
        self.node_id = node_id
        self.tenant_id = tenant_id
        
        # 子模块
        self.account_vault = AccountVault(config.get("vault_path", "./accounts.enc"))
        self.offline_queue = OfflineQueue(config.get("queue_db", "./offline_queue.db"))
        self.wss_client = None  # 由 wss_receiver.py 管理
        
        # 采集配置
        self.monitor_interval = config.get("monitor_interval_seconds", 300)  # 5分钟一次
        
        logger.info(f"边缘轻量龙虾启动 | node={node_id} | tenant={tenant_id}")
    
    # ══════════════════════════════════════════
    # 发布侧：接收云端包 → 执行
    # ══════════════════════════════════════════
    
    async def handle_publish_packet(self, packet: ContentPublishPacket) -> bool:
        """
        处理云端下发的发布包
        
        流程：验证 → 获取账号凭证 → 调用平台执行器 → 上报结果
        """
        logger.info(f"收到发布包 | packet={packet.packet_id} | action={packet.action} | platform={packet.platform}")
        
        # 1. 获取账号凭证（本地保险箱）
        account = self.account_vault.get(packet.account_id)
        if not account:
            await self._report_error(packet.packet_id, f"账号未注册: {packet.account_id}")
            return False
        
        # 2. 路由到对应平台执行器
        from .publish_executor import PublishExecutor
        executor = PublishExecutor(platform=packet.platform)
        
        # 3. 按定时时间执行（如有）
        if packet.schedule_time and packet.schedule_time > datetime.utcnow():
            delay = (packet.schedule_time - datetime.utcnow()).total_seconds()
            logger.info(f"定时发布，等待 {delay:.0f}s | packet={packet.packet_id}")
            await asyncio.sleep(delay)
        
        # 4. 执行发布
        try:
            if packet.action == "post":
                result = await executor.publish_post(account, packet.content)
            elif packet.action == "reply":
                result = await executor.reply_comment(
                    account,
                    target_comment_id=packet.content["target_comment_id"],
                    reply_text=packet.content["body"],
                )
            elif packet.action == "dm":
                result = await executor.send_dm(
                    account,
                    to_user=packet.content["to_user"],
                    message=packet.content["body"],
                )
            else:
                await self._report_error(packet.packet_id, f"未知action: {packet.action}")
                return False
            
            # 5. 上报成功结果
            await self._report_publish_result(packet.packet_id, result)
            logger.info(f"发布成功 | packet={packet.packet_id}")
            return True
            
        except Exception as e:
            logger.error(f"发布失败 | packet={packet.packet_id} | error={e}")
            
            # 重试
            if packet.retry_limit > 0:
                packet.retry_limit -= 1
                await asyncio.sleep(30)
                return await self.handle_publish_packet(packet)
            
            await self._report_error(packet.packet_id, str(e))
            return False
    
    # ══════════════════════════════════════════
    # 采集侧：监控账号 → 上报云端
    # ══════════════════════════════════════════
    
    async def run_monitor_loop(self):
        """
        监控循环：定时采集所有账号数据，上报给云端龙虾
        """
        logger.info(f"启动监控循环 | interval={self.monitor_interval}s")
        
        while True:
            for account_id in self.account_vault.list_accounts():
                try:
                    await self.collect_and_report(account_id)
                except Exception as e:
                    logger.error(f"采集失败 | account={account_id} | error={e}")
            
            await asyncio.sleep(self.monitor_interval)
    
    async def collect_and_report(self, account_id: str):
        """
        采集账号数据并上报
        
        ⚠️ 只采集+上报，不做任何 LLM 分析！
        """
        account = self.account_vault.get(account_id)
        if not account:
            return
        
        from .monitor_collector import MonitorCollector
        collector = MonitorCollector(platform=account.platform)
        
        # 采集评论
        new_comments = await collector.fetch_new_comments(account)
        if new_comments:
            await self._upload_monitor_data(MonitorDataPacket(
                packet_id=f"monitor-{account_id}-comments-{int(datetime.utcnow().timestamp())}",
                tenant_id=self.tenant_id,
                account_id=account_id,
                platform=account.platform,
                data_type="comments",
                data=new_comments,
                basic_stats={
                    "count": len(new_comments),
                    "from_time": new_comments[0].get("timestamp"),
                    "to_time": new_comments[-1].get("timestamp"),
                },
            ))
        
        # 采集私信
        new_dms = await collector.fetch_new_dms(account)
        if new_dms:
            await self._upload_monitor_data(MonitorDataPacket(
                packet_id=f"monitor-{account_id}-dms-{int(datetime.utcnow().timestamp())}",
                tenant_id=self.tenant_id,
                account_id=account_id,
                platform=account.platform,
                data_type="dm_messages",
                data=new_dms,
                basic_stats={"count": len(new_dms)},
            ))
        
        # 采集账号统计（粉丝/互动）
        stats = await collector.fetch_account_stats(account)
        if stats:
            await self._upload_monitor_data(MonitorDataPacket(
                packet_id=f"monitor-{account_id}-stats-{int(datetime.utcnow().timestamp())}",
                tenant_id=self.tenant_id,
                account_id=account_id,
                platform=account.platform,
                data_type="post_stats",
                data=[stats],
                basic_stats={},
            ))
    
    # ══════════════════════════════════════════
    # WSS 通信（上行/下行）
    # ══════════════════════════════════════════
    
    async def _upload_monitor_data(self, packet: MonitorDataPacket):
        """上传监控数据到云端"""
        import dataclasses
        payload = {
            "type": "monitor_data",
            "data": dataclasses.asdict(packet),
        }
        
        if self.wss_client and self.wss_client.is_connected():
            await self.wss_client.send(payload)
            logger.debug(f"上报监控数据 | type={packet.data_type} | count={len(packet.data)}")
        else:
            # 离线时缓存到本地队列
            await self.offline_queue.push(payload)
            logger.warning(f"WSS 断开，监控数据已缓存到离线队列")
    
    async def _report_publish_result(self, packet_id: str, result: dict):
        """上报发布结果"""
        payload = {
            "type": "publish_result",
            "packet_id": packet_id,
            "result": result,
            "timestamp": datetime.utcnow().isoformat(),
        }
        if self.wss_client and self.wss_client.is_connected():
            await self.wss_client.send(payload)
        else:
            await self.offline_queue.push(payload)
    
    async def _report_error(self, packet_id: str, error: str):
        """上报错误"""
        await self._report_publish_result(packet_id, {"success": False, "error": error})
    
    async def flush_offline_queue(self):
        """WSS 恢复连接后，发送离线期间缓存的数据"""
        count = 0
        while not await self.offline_queue.is_empty():
            payload = await self.offline_queue.pop()
            await self.wss_client.send(payload)
            count += 1
        
        if count > 0:
            logger.info(f"离线队列已清空，共发送 {count} 条缓存数据")
```

### 3.2 账号凭证保险箱

```python
# edge-runtime/account_vault.py
"""
账号凭证本地保险箱
- 加密存储客户平台账号的 Cookie/Token
- 永不上传云端
- 支持多平台、多账号
"""

import json
import os
from cryptography.fernet import Fernet
from dataclasses import dataclass

@dataclass
class AccountCredential:
    account_id: str
    platform: str           # "xiaohongshu" | "douyin" | "weixin"
    account_name: str       # 账号昵称（展示用）
    cookies: dict           # 平台 Cookie
    extra: dict = None      # 额外凭证（access_token 等）


class AccountVault:
    """本地加密账号保险箱"""
    
    def __init__(self, vault_path: str):
        self.vault_path = vault_path
        self._key = self._load_or_generate_key()
        self._fernet = Fernet(self._key)
        self._accounts: dict[str, AccountCredential] = {}
        self._load()
    
    def get(self, account_id: str) -> Optional[AccountCredential]:
        return self._accounts.get(account_id)
    
    def list_accounts(self) -> list[str]:
        return list(self._accounts.keys())
    
    def add_account(self, credential: AccountCredential):
        """添加账号（通常在初始配置时调用）"""
        self._accounts[credential.account_id] = credential
        self._save()
    
    def _load_or_generate_key(self) -> bytes:
        key_path = self.vault_path + ".key"
        if os.path.exists(key_path):
            with open(key_path, "rb") as f:
                return f.read()
        key = Fernet.generate_key()
        with open(key_path, "wb") as f:
            f.write(key)
        return key
    
    def _load(self):
        if not os.path.exists(self.vault_path):
            return
        with open(self.vault_path, "rb") as f:
            encrypted = f.read()
        raw = self._fernet.decrypt(encrypted)
        data = json.loads(raw)
        self._accounts = {k: AccountCredential(**v) for k, v in data.items()}
    
    def _save(self):
        data = {k: vars(v) for k, v in self._accounts.items()}
        raw = json.dumps(data).encode()
        encrypted = self._fernet.encrypt(raw)
        with open(self.vault_path, "wb") as f:
            f.write(encrypted)
```

---

## 四、云端侧：边缘数据接收处理

```python
# dragon-senate-saas-v2/edge_data_processor.py（新建）
"""
云端接收边缘上报的数据
分发给对应云端龙虾做 LLM 分析
"""

from .task_queue import TaskQueue

task_queue = TaskQueue()

async def process_monitor_packet(raw_packet: dict):
    """
    处理边缘上报的监控数据包
    
    路由规则：
    - comments → 阿声(echoer) 分析情感+生成回复
    - dm_messages → 小锤(followup) 分析需求+生成跟进
    - post_stats → 算无遗策(abacus) 分析数据+生成报告
    - fans_change → 林涛(radar) 分析用户变化
    """
    data_type = raw_packet["data_type"]
    account_id = raw_packet["account_id"]
    
    lobster_routing = {
        "comments": ("echoer", "analyze_and_reply_comments"),
        "dm_messages": ("followup", "analyze_and_followup_dms"),
        "post_stats": ("abacus", "analyze_post_performance"),
        "fans_change": ("radar", "analyze_audience_change"),
    }
    
    if data_type not in lobster_routing:
        logger.warning(f"未知 data_type: {data_type}")
        return
    
    lobster_id, task_name = lobster_routing[data_type]
    
    # 提交给云端龙虾处理
    await task_queue.submit({
        "lobster_id": lobster_id,
        "task_name": task_name,
        "account_id": account_id,
        "payload": raw_packet["data"],
        "source": "edge_monitor",
    })
    
    logger.info(f"边缘数据已路由 | type={data_type} → lobster={lobster_id}")
```

---

## 五、验收标准

- [ ] `EdgeLiteLobster.handle_publish_packet()` 正确执行 post/reply/dm
- [ ] `AccountVault` 加密存储账号凭证，本地读写正常
- [ ] `run_monitor_loop()` 定时采集评论/私信并上报
- [ ] WSS 断开时：发布包缓存到 `offline_queue`，恢复后自动发送
- [ ] `edge_data_processor.py` 正确路由：评论→阿声、私信→小锤
- [ ] 账号凭证绝不出现在上行数据包中
- [ ] 所有操作有本地日志（操作类型/账号/时间/结果）
- [ ] 单节点支持管理 10+ 个平台账号
