# 中国大陆 7 平台渠道扩展方案 — 龙虾分工 + 适配器架构

> 日期: 2026-03-31
> 目标: 对接抖音、小红书、快手、淘宝、京东、拼多多、微信 7 大平台

---

## 一、结论：每个平台对应哪些龙虾

### 平台 × 龙虾 矩阵

| 龙虾 | 抖音 | 小红书 | 快手 | 淘宝 | 京东 | 拼多多 | 微信 |
|------|------|--------|------|------|------|--------|------|
| 🦐 radar (触须虾) | ✅ 热搜/话题扫描 | ✅ 笔记趋势 | ✅ 热门话题 | ✅ 搜索词/飙升榜 | ✅ 搜索词 | ✅ 搜索词 | ⚠️ 公众号热文 |
| 🦐 strategist (脑虫虾) | ✅ 投放策略 | ✅ 种草策略 | ✅ 内容策略 | ✅ 商品策略 | ✅ 商品策略 | ✅ 低价策略 | ✅ 私域策略 |
| 🦐 inkwriter (吐墨虾) | ✅ 短视频脚本 | ✅ 图文笔记 | ✅ 短视频脚本 | ✅ 商品文案 | ✅ 商品文案 | ✅ 商品文案 | ✅ 朋友圈/公众号 |
| 🦐 visualizer (幻影虾) | ✅ 视频渲染 | ✅ 图片/视频 | ✅ 视频渲染 | ✅ 主图/详情页 | ✅ 主图/详情页 | ✅ 主图 | ✅ 朋友圈图 |
| 🦐 dispatcher (点兵虾) | ✅ 发布调度 | ✅ 发布调度 | ✅ 发布调度 | ⚠️ 上架调度 | ⚠️ 上架调度 | ⚠️ 上架调度 | ✅ 群发调度 |
| 🦐 echoer (回声虾) | ✅ 评论互动 | ✅ 评论互动 | ✅ 评论互动 | ✅ 旺旺客服 | ✅ 咚咚客服 | ✅ 拼多多客服 | ✅ 私聊回复 |
| 🦐 catcher (铁网虾) | ✅ 私信线索 | ✅ 私信线索 | ✅ 私信线索 | ✅ 咨询转化 | ✅ 咨询转化 | ✅ 咨询转化 | ✅ 好友请求 |
| 🦐 abacus (金算虾) | ✅ 线索评分 | ✅ 线索评分 | ✅ 线索评分 | ✅ 订单归因 | ✅ 订单归因 | ✅ 订单归因 | ✅ 线索评分 |
| 🦐 followup (回访虾) | ✅ 私信跟进 | ✅ 私信跟进 | ✅ 私信跟进 | ✅ 售后跟进 | ✅ 售后跟进 | ✅ 售后跟进 | ✅ 微信跟进 |

### 关键发现

**9只虾全部参与**，但参与深度分3层：

| 层级 | 龙虾 | 说明 |
|------|------|------|
| **核心层（全平台通用）** | strategist, inkwriter, abacus | 策略/文案/评分逻辑与平台无关，只需调整 prompt 中的平台特征 |
| **渠道感知层** | echoer, catcher, followup | 需要知道当前渠道的消息格式、回复限制、互动规则 |
| **平台执行层** | radar, visualizer, dispatcher | 需要平台API对接，信号采集和内容发布的具体执行 |

---

## 二、7 平台按特征分组

### A 组：内容种草平台（抖音 / 小红书 / 快手）

| 维度 | 抖音 | 小红书 | 快手 |
|------|------|--------|------|
| 核心内容类型 | 短视频 | 图文笔记 + 视频 | 短视频 |
| 互动方式 | 评论 + 私信 | 评论 + 私信 + 小纸条 | 评论 + 私信 |
| 成交路径 | 小黄车 / 私信 → 微信 | 笔记挂商品 / 私信 | 小店 / 私信 |
| API 对接 | 抖音开放平台 | 小红书开放平台 | 快手开放平台 |
| 优先级 | ⭐⭐⭐ P0 | ⭐⭐⭐ P0 | ⭐⭐ P1 |

**核心龙虾链路**：`radar → strategist → inkwriter → visualizer → dispatcher → echoer → catcher → abacus → followup`（完整链路）

### B 组：电商交易平台（淘宝 / 京东 / 拼多多）

| 维度 | 淘宝 | 京东 | 拼多多 |
|------|------|------|--------|
| 核心内容类型 | 商品详情页 + 短视频 | 商品详情页 | 商品主图 + 标题 |
| 互动方式 | 旺旺客服 + 评论 | 咚咚客服 + 评论 | 平台客服 + 评论 |
| 成交路径 | 店内直接成交 | 店内直接成交 | 拼团成交 |
| API 对接 | 淘宝开放平台 (TOP) | 京东宙斯 (JOS) | 拼多多开放平台 |
| 优先级 | ⭐⭐ P1 | ⭐ P2 | ⭐ P2 |

**核心龙虾链路**：`radar → strategist → inkwriter → visualizer → echoer(客服) → catcher → abacus → followup`
- dispatcher 在电商场景变为"上架/调价调度"
- radar 在电商场景变为"搜索词/竞品价格监控"

### C 组：私域沉淀平台（微信）

| 维度 | 微信 |
|------|------|
| 核心内容类型 | 朋友圈 + 公众号 + 视频号 + 群消息 |
| 互动方式 | 私聊 + 群聊 + 公众号留言 |
| 成交路径 | 私聊 → 小程序/转账 |
| API 对接 | 企业微信API / 公众号API / 视频号API |
| 优先级 | ⭐⭐⭐ P0 |

**核心龙虾链路**：`strategist → inkwriter → echoer → catcher → followup`
- 微信是"终点站"——其他平台引流到微信后的成交闭环
- radar 在微信场景较轻（主要靠其他平台引流过来的数据）

---

## 三、架构分层设计

```
┌─────────────────────────────────────────────────────────┐
│                    龙虾元老院 (Cloud)                      │
│  dragon_senate.py (LangGraph)                           │
│  ┌──────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐        │
│  │radar │→│strategist│→│inkwriter│→│visualizer│        │
│  └──────┘ └──────────┘ └─────────┘ └──────────┘        │
│      ↓                                    ↓              │
│  ┌──────────┐  ┌──────┐  ┌───────┐  ┌────────┐         │
│  │dispatcher│→ │echoer│→ │catcher│→ │abacus  │         │
│  └──────────┘  └──────┘  └───────┘  └────────┘         │
│                                          ↓              │
│                                    ┌──────────┐         │
│                                    │ followup │         │
│                                    └──────────┘         │
└────────────────────┬────────────────────────────────────┘
                     │ 统一渠道路由层 (ChannelRouter)
                     │ ← 新增模块
                     ▼
┌─────────────────────────────────────────────────────────┐
│              渠道适配器层 (ChannelAdapters)                │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 已有:                                            │   │
│  │  feishu_channel.py    (飞书)                      │   │
│  │  dingtalk_channel.py  (钉钉)                      │   │
│  │  telegram_bot.py      (Telegram)                  │   │
│  ├──────────────────────────────────────────────────┤   │
│  │ 新建 (A组 — 内容种草):                             │   │
│  │  douyin_channel.py    (抖音)        ← P0          │   │
│  │  xiaohongshu_channel.py (小红书)    ← P0          │   │
│  │  kuaishou_channel.py  (快手)        ← P1          │   │
│  ├──────────────────────────────────────────────────┤   │
│  │ 新建 (B组 — 电商):                                │   │
│  │  taobao_channel.py    (淘宝/天猫)   ← P1          │   │
│  │  jd_channel.py        (京东)        ← P2          │   │
│  │  pdd_channel.py       (拼多多)      ← P2          │   │
│  ├──────────────────────────────────────────────────┤   │
│  │ 新建 (C组 — 私域):                                │   │
│  │  wechat_channel.py    (微信/企微)   ← P0          │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              边缘执行器 (Edge Runtime)                     │
│  edge-runtime/                                          │
│  - wss_receiver.py      (接收云端指令)                   │
│  - marionette_executor.py (执行浏览器自动化)              │
│  - context_navigator.py  (页面上下文理解)                 │
│  - memory_consolidator.py (记忆归纳)                     │
│                                                         │
│  每个客户机一个 edge，登录各平台账号执行操作              │
└─────────────────────────────────────────────────────────┘
```

---

## 四、每个适配器的标准接口

参考 `FeishuChannelAdapter`，所有渠道适配器必须实现以下标准接口：

```python
@dataclass
class ChannelMessage:
    """统一消息信封"""
    channel: str          # "douyin" | "xiaohongshu" | "kuaishou" | ...
    chat_id: str          # 会话/用户ID
    user_text: str        # 用户消息文本
    user_id: str          # 平台用户ID
    message_type: str     # "text" | "image" | "video" | "comment" | "dm"
    platform_meta: dict   # 平台特有元数据
    raw: dict             # 原始 payload

class BaseChannelAdapter:
    """所有渠道适配器的基类"""
    
    channel_id: str                    # 渠道标识
    enabled: bool                      # 是否启用
    
    def reload_from_env(self) -> None: ...          # 从环境变量重新加载配置
    def parse_event(self, payload) -> ChannelMessage | None: ...  # 解析 webhook
    async def reply(self, *, chat_id, text, **kw) -> dict: ...    # 发送回复
    async def publish(self, *, content, **kw) -> dict: ...        # 发布内容（新增）
    async def fetch_comments(self, *, post_id, **kw) -> list: ... # 拉取评论（新增）
    async def fetch_dms(self, *, since, **kw) -> list: ...        # 拉取私信（新增）
    def describe(self) -> dict: ...                                # 状态描述
```

### 与现有 Feishu/DingTalk 适配器的区别

现有适配器只有 `parse_event` + `reply`（消息驱动的即时通讯模式）。

新平台需要额外方法：
- `publish()` — 发布内容（视频/图文/商品）
- `fetch_comments()` — 拉取评论（用于 echoer/catcher）
- `fetch_dms()` — 拉取私信（用于 catcher/followup）

---

## 五、各平台具体适配器设计

### 5.1 抖音 `douyin_channel.py` — P0

```python
class DouyinChannelAdapter(BaseChannelAdapter):
    channel_id = "douyin"
    
    # 环境变量
    # DOUYIN_APP_KEY, DOUYIN_APP_SECRET, DOUYIN_ACCESS_TOKEN
    
    # 核心能力
    async def publish(self, *, video_url, title, cover_url, **kw):
        """通过抖音开放平台 API 发布视频"""
    
    async def fetch_comments(self, *, item_id, cursor, count=20):
        """拉取视频评论 → 交给 echoer/catcher"""
    
    async def reply_comment(self, *, item_id, comment_id, text):
        """回复评论 → echoer 使用"""
    
    async def fetch_dms(self, *, since):
        """拉取私信 → catcher 使用"""
    
    async def send_dm(self, *, to_user_id, text):
        """发送私信 → followup 使用"""
    
    async def fetch_hot_topics(self):
        """热搜榜 → radar 使用"""

# 涉及龙虾: 全部 9 只
```

### 5.2 小红书 `xiaohongshu_channel.py` — P0

```python
class XiaohongshuChannelAdapter(BaseChannelAdapter):
    channel_id = "xiaohongshu"
    
    # 核心能力
    async def publish(self, *, images=None, video_url=None, title, content):
        """发布笔记（图文或视频）"""
    
    async def fetch_comments(self, *, note_id, cursor):
        """拉取笔记评论"""
    
    async def reply_comment(self, *, note_id, comment_id, text):
        """回复评论"""
    
    async def fetch_dms(self, *, since):
        """拉取私信/小纸条"""
    
    async def send_dm(self, *, to_user_id, text):
        """发送私信"""
    
    async def search_notes(self, *, keyword, sort_by="hot"):
        """搜索笔记 → radar 使用"""

# 涉及龙虾: 全部 9 只
# 特殊: inkwriter 需要输出图文格式而非纯视频脚本
```

### 5.3 快手 `kuaishou_channel.py` — P1

```python
class KuaishouChannelAdapter(BaseChannelAdapter):
    channel_id = "kuaishou"
    # 与抖音类似，API 不同
    # 涉及龙虾: 全部 9 只
```

### 5.4 淘宝 `taobao_channel.py` — P1

```python
class TaobaoChannelAdapter(BaseChannelAdapter):
    channel_id = "taobao"
    
    # 环境变量
    # TAOBAO_APP_KEY, TAOBAO_APP_SECRET, TAOBAO_SESSION_KEY
    
    # 核心能力（与种草平台不同）
    async def update_product(self, *, item_id, title, desc, images):
        """更新商品标题/描述/主图 → inkwriter+visualizer 输出"""
    
    async def fetch_customer_messages(self, *, since):
        """拉取旺旺客服消息 → echoer/catcher"""
    
    async def reply_customer(self, *, buyer_nick, text):
        """回复旺旺消息 → echoer"""
    
    async def fetch_reviews(self, *, item_id):
        """拉取商品评价 → radar/catcher"""
    
    async def fetch_search_keywords(self, *, category_id):
        """搜索词分析 → radar"""

# 涉及龙虾: radar, strategist, inkwriter, visualizer, echoer, catcher, abacus, followup
# 特殊: dispatcher 变为"上架/调价调度"
```

### 5.5 京东 `jd_channel.py` — P2

```python
class JDChannelAdapter(BaseChannelAdapter):
    channel_id = "jd"
    # 与淘宝类似，使用京东宙斯(JOS) API
    # 客服系统: 咚咚
```

### 5.6 拼多多 `pdd_channel.py` — P2

```python
class PDDChannelAdapter(BaseChannelAdapter):
    channel_id = "pdd"
    # 与淘宝类似，使用拼多多开放平台 API
    # 特殊: 拼团机制, 价格更敏感
```

### 5.7 微信 `wechat_channel.py` — P0

```python
class WechatChannelAdapter(BaseChannelAdapter):
    channel_id = "wechat"
    
    # 环境变量
    # WECHAT_CORP_ID, WECHAT_CORP_SECRET (企业微信)
    # WECHAT_MP_APPID, WECHAT_MP_SECRET (公众号)
    
    # 核心能力
    async def send_message(self, *, to_user, text):
        """企微/微信私聊 → followup"""
    
    async def send_group_message(self, *, group_id, text):
        """群消息 → echoer"""
    
    async def publish_moment(self, *, text, images=None):
        """朋友圈 → dispatcher"""
    
    async def publish_article(self, *, title, content, cover):
        """公众号文章 → inkwriter+visualizer"""
    
    async def fetch_messages(self, *, since):
        """拉取消息 → catcher"""
    
    async def add_friend(self, *, user_id, greeting):
        """好友请求 → followup"""

# 涉及龙虾: strategist, inkwriter, echoer, catcher, abacus, followup
# 核心定位: 成交闭环 — 其他平台引流过来在这里转化
```

---

## 六、龙虾需要哪些渠道感知改造

### 不需要改的龙虾（平台无关）
| 龙虾 | 原因 |
|------|------|
| **strategist** | 策略生成只依赖 state 中的 industry_tag 和 hot_topics，已平台无关 |
| **abacus** | 评分逻辑与平台无关，只看 intent/行为特征 |

### 需要渠道感知的龙虾
| 龙虾 | 改造内容 | 工作量 |
|------|---------|--------|
| **radar** | `state.platforms` 列表 → 按平台调用不同适配器的 `fetch_hot_topics` / `search_notes` / `fetch_search_keywords` | 中 |
| **inkwriter** | 根据 `state.channel` 切换输出格式（视频脚本 / 图文笔记 / 商品文案 / 朋友圈文案） | 中 |
| **visualizer** | 根据 `state.channel` 切换渲染规格（竖版视频 / 方图 / 商品主图 / 详情页） | 中 |
| **dispatcher** | 根据 `state.channel` 调用不同适配器的 `publish()` / `update_product()` | 高 |
| **echoer** | 根据 `state.channel` 调整回复风格（评论150字 / 旺旺客服 / 微信私聊） | 低 |
| **catcher** | 根据 `state.channel` 使用不同的 `fetch_dms()` / `fetch_customer_messages()` | 中 |
| **followup** | 根据 `state.channel` 使用不同的 `send_dm()` / `send_message()` / `reply_customer()` | 中 |

### 实现方式：在 DragonState 中新增字段

```python
class DragonState(TypedDict, total=False):
    # 新增渠道字段
    target_channels: list[str]      # ["douyin", "xiaohongshu", "wechat"]
    primary_channel: str             # "douyin" — 当前主力渠道
    channel_config: dict[str, Any]   # 渠道特定配置
```

---

## 七、实现优先级路线图

### Wave 1（本周）— 3 个 P0 平台
| 任务 | 算力 | 输出 |
|------|------|------|
| `BaseChannelAdapter` 基类 | 低 | 统一接口定义 |
| `douyin_channel.py` | 中 | 抖音适配器 |
| `xiaohongshu_channel.py` | 中 | 小红书适配器 |
| `wechat_channel.py` | 中 | 微信/企微适配器 |
| `ChannelRouter` 统一路由 | 中 | app.py 中的渠道分发 |

### Wave 2（第2周）— 2 个 P1 平台
| 任务 | 算力 | 输出 |
|------|------|------|
| `kuaishou_channel.py` | 中 | 快手适配器 |
| `taobao_channel.py` | 中 | 淘宝适配器 |
| 龙虾渠道感知改造 (inkwriter/echoer) | 中 | 渠道感知 prompt |

### Wave 3（第3周）— 2 个 P2 平台
| 任务 | 算力 | 输出 |
|------|------|------|
| `jd_channel.py` | 中 | 京东适配器 |
| `pdd_channel.py` | 中 | 拼多多适配器 |
| 龙虾渠道感知改造 (dispatcher/catcher/followup) | 高 | 完整多渠道支持 |

---

## 八、哪些可以给 Codex 做

**可以立即给 Codex 的低耦合任务**：

1. **`BaseChannelAdapter` 基类** — 参考 `FeishuChannelAdapter`，定义统一接口
2. **`douyin_channel.py` 骨架** — 接口定义 + 环境变量加载 + mock 实现
3. **`xiaohongshu_channel.py` 骨架** — 同上
4. **`wechat_channel.py` 骨架** — 同上
5. **`kuaishou_channel.py` 骨架** — 同上
6. **`taobao_channel.py` 骨架** — 同上
7. **`industry_starter_kit.py` 更新** — `_normalize_channel_family()` 添加新渠道

这些任务之间**完全无依赖**，可以并行执行。

---

## 九、交接摘要

**核心决策**：
1. 9 只龙虾全部参与，但分 3 层（核心/渠道感知/平台执行）
2. 7 个平台分 3 组（A组内容种草 / B组电商交易 / C组私域沉淀）
3. 渠道适配器统一继承 `BaseChannelAdapter`，扩展 `publish/fetch_comments/fetch_dms` 方法
4. 龙虾侧改造通过 `state.target_channels` + `state.primary_channel` 做渠道感知
5. P0 先做抖音+小红书+微信（覆盖 80% 大陆客户场景）

**信息缺口**：
- 各平台开放平台 API 的具体审核要求和权限等级
- 客户是否需要自带各平台账号（还是我们代运营）
- 边缘执行器（edge-runtime）在各平台的自动化策略（API 优先还是 RPA 优先）
