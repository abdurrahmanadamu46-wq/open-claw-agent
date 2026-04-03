# CODEX TASK: Wazuh 借鉴 P2 合并任务包

**优先级：P2**  
**来源：WAZUH_BORROWING_ANALYSIS.md P2-1 ～ P2-5**  
**借鉴自**：Wazuh ⭐15.1k（XDR/SIEM 安全平台）

---

## P2-1: 营销行为分类矩阵（MarketingFunnelMatrix）

**借鉴自**：Wazuh `ruleset/mitre/` MITRE ATT&CK 三级分类框架  
**落地路径**：前端 `/analytics/funnel-matrix` 页面

### 功能说明
Wazuh 用 MITRE ATT&CK（战术/技术/子技术）对威胁行为三级分类，并用热力图可视化。  
我们对应建立**营销漏斗行为分类矩阵**（仿 MITRE 结构）：

```
阶段（战术）  →  行为类型（技术）  →  具体动作（子技术）
────────────────────────────────────────────────────
Awareness     →  内容曝光         →  视频播放/文章阅读/广告点击
Interest      →  主动探索         →  官网访问/案例下载/搜索品牌词
Desire        →  意向信号         →  价格查询/竞品对比/留资表单
Action        →  转化动作         →  试用申请/购买/签约
Retention     →  复购信号         →  续费咨询/新需求提交/转介绍
```

前端热力图：X轴=时间，Y轴=行为类型，颜色深浅=发生频次  
点击某个格子 → 展示该行为的详细事件列表

### 验收标准
- [ ] 营销漏斗行为分类 JSON Schema（3层结构：阶段/类型/动作）
- [ ] 前端热力图组件（基于 shadcn charts，时间×行为类型）
- [ ] 点击下钻：从矩阵格子→对应事件列表
- [ ] 每只龙虾任务自动映射到矩阵某个行为类型

---

## P2-2: 云平台信号插件体系（Wodles 模式）

**借鉴自**：Wazuh `wodles/` — aws/azure/gcloud 独立插件，统一接口  
**落地路径**：`edge-runtime/wodles/` 目录

### 功能说明
Wazuh 的 wodles 设计模式：每个云平台一个独立目录，统一入口 `utils.py`，独立配置独立运行。  
我们对应建立**营销渠道信号插件（Wodles）**：

```
edge-runtime/wodles/
├── feishu_wodle.py       ← 飞书群消息监听
├── wecom_wodle.py        ← 企业微信事件拉取
├── dingtalk_wodle.py     ← 钉钉消息监听
├── wechat_mp_wodle.py    ← 微信公众号粉丝事件
├── douyin_wodle.py       ← 抖音评论/私信信号
└── base_wodle.py         ← Wodle 基类
```

```python
# edge-runtime/wodles/base_wodle.py
from abc import ABC, abstractmethod

class BaseWodle(ABC):
    name: str = "base"
    
    def __init__(self, config: dict):
        self.config = config
        self.enabled = config.get("enabled", True)
    
    @abstractmethod
    async def run(self) -> list[dict]:
        """拉取/监听信号，返回标准化事件列表"""
        ...
    
    def normalize(self, raw: dict) -> dict:
        """标准化信号格式"""
        return {
            "source": self.name,
            "event_type": raw.get("type", "unknown"),
            "content": raw.get("content", ""),
            "user_id": raw.get("user_id"),
            "timestamp": raw.get("timestamp"),
            "raw": raw,
        }
```

### 验收标准
- [ ] `BaseWodle` 基类定义（run/normalize 接口）
- [ ] `FeishuWodle` 实现（监听飞书群消息→标准化→上报）
- [ ] `WecomWodle` 实现（拉取企微事件→标准化→上报）
- [ ] `EdgeGuardian` 支持动态注册 Wodle 模块
- [ ] 配置文件驱动（`wodles.yaml` 控制每个 Wodle 的启停）

---

## P2-3: API 请求全量访问日志（ApiAccessLogger）

**借鉴自**：Wazuh `api/api/alogging.py`  
**落地路径**：`dragon-senate-saas-v2/api_access_logger.py` + FastAPI 中间件

### 功能说明
Wazuh `alogging.py` 对每个 API 请求记录：请求路径/方法/用户/响应码/响应时间/错误。  
我们目前 `llm_call_logger.py` 只记录 LLM 调用，API 层无访问日志，安全审计有盲区。

```python
# dragon-senate-saas-v2/api_access_logger.py
import time
import uuid
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

class ApiAccessLoggerMiddleware(BaseHTTPMiddleware):
    """API 请求全量访问日志中间件"""

    def __init__(self, app, log_store):
        super().__init__(app)
        self.log_store = log_store

    async def dispatch(self, request: Request, call_next):
        request_id = uuid.uuid4().hex[:12]
        start = time.time()
        
        # 提取认证信息
        tenant_id = request.headers.get("X-Tenant-Id", "unknown")
        user_id = request.headers.get("X-User-Id", "anonymous")
        
        response: Response = await call_next(request)
        duration_ms = round((time.time() - start) * 1000, 2)
        
        await self.log_store.append({
            "request_id": request_id,
            "method": request.method,
            "path": str(request.url.path),
            "query": str(request.url.query),
            "status_code": response.status_code,
            "duration_ms": duration_ms,
            "tenant_id": tenant_id,
            "user_id": user_id,
            "ip": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
        })
        
        response.headers["X-Request-Id"] = request_id
        return response
```

### 验收标准
- [ ] `ApiAccessLoggerMiddleware` 注册到 FastAPI app
- [ ] 每次 API 请求写入访问日志（路径/状态/耗时/用户）
- [ ] `GET /api/v1/admin/access-logs` 支持按租户/时间/路径过滤
- [ ] 敏感路径（/api/v1/admin/）额外标记 `is_admin=true`

---

## P2-4: 龙虾模块化独立启停（LobsterModuleManager）

**借鉴自**：Wazuh `src/wazuh_modules/` 功能模块独立启停  
**落地路径**：`dragon-senate-saas-v2/lobster_module_manager.py`

### 功能说明
Wazuh 的每个功能模块（漏洞扫描/SCA/云监控）可独立 enable/disable，无需重启整个进程。  
我们每只龙虾应支持独立开关（按租户级别）：

```python
class LobsterModuleManager:
    """龙虾模块化启停管理器"""
    
    async def enable(self, tenant_id: str, lobster_id: str): ...
    async def disable(self, tenant_id: str, lobster_id: str): ...
    async def get_status(self, tenant_id: str) -> dict: ...
    async def is_enabled(self, tenant_id: str, lobster_id: str) -> bool: ...
```

### 验收标准
- [ ] 每只龙虾可按租户级别独立启停（不影响其他租户）
- [ ] 禁用的龙虾拒绝接受新任务（返回 409）
- [ ] 前端龙虾控制台显示启停开关
- [ ] 启停变更写入 `tenant_audit_log`

---

## P2-5: radar 多源信号采集标准化（SignalCollector）

**借鉴自**：Wazuh `src/logcollector/` 多源日志采集，统一格式化  
**落地路径**：`dragon-senate-saas-v2/signal_collector.py`

### 功能说明
Wazuh logcollector 支持：文件尾读/Syslog UDP/Windows事件/命令执行输出，统一格式化为标准事件。  
radar 虾当前每个来源有独立抓取逻辑，无统一格式，下游龙虾处理困难。

**统一信号格式：**
```python
class Signal(BaseModel):
    signal_id: str
    source: str           # "weibo" | "douyin" | "zhihu" | "wechat_mp" | "web"
    source_type: str      # "social" | "search" | "news" | "im"
    content: str
    author: Optional[str]
    url: Optional[str]
    published_at: Optional[datetime]
    collected_at: datetime
    tenant_id: str
    tags: list[str] = []
    sentiment: Optional[float]   # -1 ~ 1
    relevance_score: Optional[float]  # 0 ~ 1
    category: Optional[str]      # "brand" | "competitor" | "industry" | "lead"
    raw: dict = {}
```

### 验收标准
- [ ] `Signal` 标准数据模型（含 source/sentiment/category）
- [ ] `SignalCollector` 基类（各来源继承实现）
- [ ] `WeiboCollector` / `ZhihuCollector` 实现标准 Signal
- [ ] radar 虾输出统一为 Signal 列表（替换当前非结构化输出）
- [ ] `POST /api/v1/signals` 接收外部推送的 Signal

---

*Codex Task | 来源：WAZUH_BORROWING_ANALYSIS.md P2-1~P2-5 合并 | 2026-04-02*
