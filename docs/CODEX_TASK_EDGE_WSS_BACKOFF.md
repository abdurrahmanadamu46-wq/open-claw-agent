# CODEX TASK: WebSocket 指数退避重连（防重连风暴）

**优先级：P1**  
**来源：MESHCENTRAL_BORROWING_ANALYSIS.md P1-#1（MeshAgent 重连策略）**

---

## 背景

`edge-runtime/wss_receiver.py` 目前使用固定间隔重连（如每5秒）。当云端重启或网络抖动导致大量边缘节点同时断线时，所有节点在固定时间后同时发起重连，形成"重连风暴"，可能压垮云端 WebSocket 服务器。借鉴 MeshCentral MeshAgent 的指数退避 + 随机抖动策略，工程量极小（<30行），效果显著。

---

## 一、改造 wss_receiver.py

```python
# edge-runtime/wss_receiver.py

import asyncio
import random
import logging
import time

logger = logging.getLogger(__name__)

# ── 退避配置 ─────────────────────────────────────────────────
BACKOFF_BASE_SEC   = 1.0    # 初始退避时间（秒）
BACKOFF_MULTIPLIER = 2.0    # 退避倍数（指数增长）
BACKOFF_MAX_SEC    = 120.0  # 最大退避时间（2分钟）
BACKOFF_JITTER     = 0.5    # 随机抖动比例（±50%）


class ExponentialBackoff:
    """指数退避计算器（MeshAgent 模式）"""

    def __init__(
        self,
        base: float = BACKOFF_BASE_SEC,
        multiplier: float = BACKOFF_MULTIPLIER,
        max_delay: float = BACKOFF_MAX_SEC,
        jitter: float = BACKOFF_JITTER,
    ):
        self.base = base
        self.multiplier = multiplier
        self.max_delay = max_delay
        self.jitter = jitter
        self._retry_count = 0
        self._connected_at: float = 0.0

    def next_delay(self) -> float:
        """
        计算下次重连等待时间：
          delay = min(base * multiplier^retry, max_delay)
          jitter = delay * jitter_ratio * uniform(-1, 1)
          actual = delay + jitter  （确保 >= 0.5s）
        """
        raw = min(
            self.base * (self.multiplier ** self._retry_count),
            self.max_delay,
        )
        jitter_val = raw * self.jitter * (random.random() * 2 - 1)
        actual = max(0.5, raw + jitter_val)
        self._retry_count += 1
        return actual

    def on_connected(self):
        """连接成功 → 重置退避计数"""
        self._retry_count = 0
        self._connected_at = time.time()
        logger.debug("[Backoff] 连接成功，退避计数已重置")

    def on_disconnected(self):
        """连接断开 → 不重置（继续退避序列）"""
        logger.debug(f"[Backoff] 连接断开，当前重试次数={self._retry_count}")

    @property
    def retry_count(self) -> int:
        return self._retry_count

    @property
    def connected_duration_sec(self) -> float:
        if self._connected_at > 0:
            return time.time() - self._connected_at
        return 0.0


class WSSReceiver:
    """边缘端 WebSocket 接收器（带指数退避重连）"""

    def __init__(self, server_url: str, edge_id: str, api_key: str):
        self.server_url = server_url
        self.edge_id = edge_id
        self.api_key = api_key
        self._backoff = ExponentialBackoff()
        self._running = False
        self._ws = None

    async def run_forever(self):
        """主循环：断线后自动退避重连"""
        self._running = True
        logger.info(f"[WSSReceiver] 启动，连接到 {self.server_url}")

        while self._running:
            try:
                await self._connect_and_listen()
                # 连接正常关闭（服务端主动断开）→ 短暂等待后重连
                if self._running:
                    delay = self._backoff.next_delay()
                    logger.info(f"[WSSReceiver] 连接关闭，{delay:.1f}秒后重连"
                                f"（第{self._backoff.retry_count}次）")
                    await asyncio.sleep(delay)

            except Exception as e:
                self._backoff.on_disconnected()
                delay = self._backoff.next_delay()
                logger.warning(
                    f"[WSSReceiver] 连接异常: {e.__class__.__name__}: {e} "
                    f"→ {delay:.1f}秒后重连（第{self._backoff.retry_count}次）"
                )
                await asyncio.sleep(delay)

    async def _connect_and_listen(self):
        """建立连接并持续监听消息"""
        import websockets

        headers = {
            "X-Edge-ID": self.edge_id,
            "X-API-Key": self.api_key,
        }

        try:
            async with websockets.connect(
                self.server_url,
                extra_headers=headers,
                ping_interval=30,     # 每30秒发一次 ping
                ping_timeout=10,      # ping 超时10秒视为断线
                close_timeout=5,
            ) as ws:
                self._ws = ws
                self._backoff.on_connected()   # ← 关键：连接成功重置退避
                logger.info(f"[WSSReceiver] ✅ 已连接 (retry={self._backoff.retry_count}重置后)")

                # 发送连接后的初始状态上报
                await self._on_connected(ws)

                # 持续接收消息
                async for raw_msg in ws:
                    await self._dispatch(raw_msg)

        finally:
            self._ws = None

    async def _on_connected(self, ws):
        """连接建立后上报边缘节点状态"""
        import json
        from .edge_version_manager import get_version_manager
        from .edge_meta_cache import get_edge_cache

        vm = get_version_manager()
        cache = get_edge_cache()

        await ws.send(json.dumps({
            "type": "edge_hello",
            "edge_id": self.edge_id,
            "version": vm.get_current_version(),
            "pending_tasks": cache.count_pending_tasks(),
            "ts": time.time(),
        }))

    async def _dispatch(self, raw_msg: str):
        """分发消息到对应处理器"""
        import json
        try:
            msg = json.loads(raw_msg)
            msg_type = msg.get("type", "")
            handler = getattr(self, f"on_{msg_type}", None)
            if handler:
                await handler(msg)
            else:
                logger.warning(f"[WSSReceiver] 未知消息类型: {msg_type}")
        except Exception as e:
            logger.error(f"[WSSReceiver] 消息处理失败: {e}")

    async def send(self, data: dict):
        """发送消息到云端"""
        import json
        if self._ws:
            try:
                await self._ws.send(json.dumps(data))
            except Exception as e:
                logger.error(f"[WSSReceiver] 发送失败: {e}")

    def stop(self):
        self._running = False
```

---

## 二、退避序列示例

```
第1次断线 → 等待 1.0s ± 0.5s（约 0.5~1.5s）
第2次断线 → 等待 2.0s ± 1.0s（约 1.0~3.0s）
第3次断线 → 等待 4.0s ± 2.0s（约 2.0~6.0s）
第4次断线 → 等待 8.0s ± 4.0s（约 4.0~12.0s）
第5次断线 → 等待 16.0s ± 8.0s（约 8.0~24.0s）
...
第7次断线 → 等待 120s（上限）± 60.0s（约 60~180s，实际限于 max=120s，+jitter可能超过）
           → 实际最大 = min(120+60, 120*1.5) = 180s 上限建议额外 clip

连接成功 → retry_count = 0 → 下次断线从 1s 开始
```

---

## 三、单元测试

```python
# edge-runtime/tests/test_wss_backoff.py

import pytest
from edge_runtime.wss_receiver import ExponentialBackoff

def test_backoff_sequence():
    """退避时间随重试次数指数增长"""
    b = ExponentialBackoff(base=1.0, multiplier=2.0, max_delay=60.0, jitter=0.0)
    delays = [b.next_delay() for _ in range(7)]
    assert delays[0] == pytest.approx(1.0)
    assert delays[1] == pytest.approx(2.0)
    assert delays[2] == pytest.approx(4.0)
    assert delays[3] == pytest.approx(8.0)
    assert delays[4] == pytest.approx(16.0)
    assert delays[5] == pytest.approx(32.0)
    assert delays[6] == pytest.approx(60.0)  # 上限

def test_backoff_reset_on_connected():
    """连接成功后重置计数"""
    b = ExponentialBackoff(base=1.0, multiplier=2.0, max_delay=60.0, jitter=0.0)
    b.next_delay(); b.next_delay(); b.next_delay()
    assert b.retry_count == 3

    b.on_connected()
    assert b.retry_count == 0
    assert b.next_delay() == pytest.approx(1.0)  # 从头开始

def test_backoff_jitter_range():
    """抖动不超出 ±50% 范围"""
    b = ExponentialBackoff(base=10.0, multiplier=1.0, max_delay=100.0, jitter=0.5)
    for _ in range(100):
        d = b.next_delay()
        b.on_connected()  # 每次重置，保持 base=10
        assert 5.0 <= d <= 15.0, f"抖动超出范围: {d}"

def test_backoff_min_delay():
    """确保最小延迟 >= 0.5s"""
    b = ExponentialBackoff(base=0.1, multiplier=1.0, max_delay=100.0, jitter=0.5)
    for _ in range(50):
        d = b.next_delay()
        b.on_connected()
        assert d >= 0.5
```

---

## 验收标准

- [ ] `ExponentialBackoff` 类（base/multiplier/max_delay/jitter 可配置）
- [ ] `next_delay()`：指数增长，上限 `max_delay`，加 ±jitter 随机抖动
- [ ] `on_connected()`：重置 retry_count = 0
- [ ] `on_disconnected()`：记录日志（不重置）
- [ ] 最小延迟保护：`max(0.5, raw + jitter)`
- [ ] `WSSReceiver.run_forever()`：异常 → 退避等待 → 重连循环
- [ ] `WSSReceiver._connect_and_listen()`：连接成功调 `on_connected()`
- [ ] `WSSReceiver._on_connected()`：连接后上报 edge_hello 状态
- [ ] 单元测试：序列验证 / 重置验证 / 抖动范围 / 最小延迟

---

*Codex Task | 来源：MESHCENTRAL_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
