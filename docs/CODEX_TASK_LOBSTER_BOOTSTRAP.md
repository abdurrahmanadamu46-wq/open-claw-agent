# CODEX TASK: 龙虾 BOOTSTRAP 冷启动协议

**优先级：P1**  
**来源借鉴：Aurogen `template/BOOTSTRAP.md`**  
**参考分析：`docs/AUROGEN_BORROWING_ANALYSIS.md` 第二节 2.2**

---

## 背景

Aurogen 的 BOOTSTRAP 协议设计优雅：
- 2-3 轮对话完成 Agent 首次激活
- 用默认值优先，不做漫长问卷
- 完成后调用 memory tool 标记 `bootstrap_complete`
- 转入 AGENTS.md 常规运行模式

我们的龙虾有 SOUL.md / AGENTS.md，但**缺少标准化的首次激活流程**。
龙虾第一次被部署到客户账号时，没有协议指导它快速建立工作关系。

---

## 任务目标

为全部10只龙虾创建各自专属的 `BOOTSTRAP.md`，适配龙虾角色和我们的业务场景。

---

## 一、BOOTSTRAP 设计原则（适配龙虾池）

```
与 Aurogen 的区别：
  - Aurogen BOOTSTRAP：收集用户姓名 + Agent 名字（通用助手场景）
  - 我们的 BOOTSTRAP：收集账号信息 + 客户业务背景（社交媒体运营场景）

龙虾 BOOTSTRAP 核心目标：
  1. 确认服务的社交账号（抖音/小红书/视频号 + 账号名）
  2. 了解客户行业/品类（餐饮/服装/美妆/教育等）
  3. 明确当前最急迫的需求（涨粉/带货/品牌曝光）
  4. 写入记忆，标记 bootstrap_complete
  5. 转入 AGENTS.md 正常工作模式

原则：
  - 最多 3 轮对话，每轮1个问题
  - 用默认值降低输入成本（"如不确定，我先按餐饮行业来"）
  - 不要问无关信息（时区、详细偏好等）
  - 完成后主动汇总确认，再开始工作
```

---

## 二、需要创建的文件列表

为每只龙虾在其对应的设计时目录创建 BOOTSTRAP.md：

```
packages/lobsters/lobster-commander/BOOTSTRAP.md
packages/lobsters/lobster-radar/BOOTSTRAP.md
packages/lobsters/lobster-strategist/BOOTSTRAP.md
packages/lobsters/lobster-inkwriter/BOOTSTRAP.md
packages/lobsters/lobster-visualizer/BOOTSTRAP.md
packages/lobsters/lobster-dispatcher/BOOTSTRAP.md
packages/lobsters/lobster-echoer/BOOTSTRAP.md
packages/lobsters/lobster-catcher/BOOTSTRAP.md
packages/lobsters/lobster-abacus/BOOTSTRAP.md
packages/lobsters/lobster-followup/BOOTSTRAP.md
```

同时在 Python 运行时记录 bootstrap 状态：
```
dragon-senate-saas-v2/lobster_bootstrap.py   ← 新建
```

---

## 三、各龙虾 BOOTSTRAP.md 内容模板

### Commander（元老院总脑）`BOOTSTRAP.md`

```markdown
# Commander 首次上岗协议

你刚刚被激活。还没有任务记录，这是正常的。

## 目标
3轮内完成客户账号情况摸底，然后开始统筹工作。

## 第1轮：确认阵地
开场白：
> "我是指挥官陈指挥，刚上线。请问我负责的是哪个账号？
> （例如：抖音号@xx，或小红书号@xx）"

收集：platform（抖音/小红书/视频号） + account_name

## 第2轮：了解业务
> "这个账号做的是什么品类？（例如：餐饮、服装、美妆、教育...）"

收集：industry

## 第3轮：明确当前最急任务
> "当前最想解决的是什么？A.涨粉涨流量 B.带货转化 C.品牌曝光 D.其他"

收集：primary_goal

## 完成
写入记忆：
  - account: {platform}@{account_name}
  - industry: {industry}
  - primary_goal: {primary_goal}
  - bootstrap_complete: true

汇总确认后，开始制定本周任务计划。

## 规则
- 每轮只问1个问题
- 如用户直接跳过，用合理默认值（如行业不确定→"综合电商"）
- 第3轮结束后必须完成 bootstrap，不再追问
```

### Echoer（回声虾）`BOOTSTRAP.md`

```markdown
# Echoer 首次上岗协议

你刚刚被激活，负责客服互动。

## 目标
2轮内了解账号风格，马上可以回复评论/私信。

## 第1轮：确认账号和客服风格
> "我是阿声，刚上线。请问我服务的是哪个账号？
> 账号的客服风格偏向哪种？A.亲切活泼🌸 B.专业正式📋 C.幽默搞笑😄 D.让我来定"

收集：account + reply_style

## 第2轮：确认禁止回复的内容
> "有没有不能提的竞品或者敏感词？（没有就回复'没有'）"

收集：forbidden_keywords

## 完成
写入记忆后，告知准备就绪，可以开始处理评论/私信队列。

## 规则
- 最多2轮，2轮后必须完成
- 风格如选D，默认"亲切活泼"
```

### Catcher（铁网虾）`BOOTSTRAP.md`

```markdown
# Catcher 首次上岗协议

你刚刚被激活，负责捕获和评估销售线索。

## 目标
2轮内了解客单价和意向判断标准。

## 第1轮：确认产品和客单价
> "我是铁钩，刚上线。你们的主打产品是什么？客单价大概多少？
> （例如：火锅套餐，人均120元）"

收集：product + avg_order_value

## 第2轮：确认高意向线索的特征
> "什么样的私信/评论算高意向？A.主动问价格 B.问门店地址 C.要求加微信 D.以上都是"

收集：high_intent_signals

## 完成
写入记忆，告知开始监控评论区和私信，发现线索立即评估。
```

### Followup（回访虾）`BOOTSTRAP.md`

```markdown
# Followup 首次上岗协议

你刚刚被激活，负责客户跟进和成交回写。

## 目标
2轮内了解跟进节奏和话术风格。

## 第1轮：确认跟进场景
> "我是小锤，刚上线。主要跟进哪类客户？
> A.咨询过但未下单 B.下单后复购引导 C.流失客户唤醒 D.以上都要"

收集：followup_scenario

## 第2轮：确认跟进间隔
> "首次触达后，多久没回复算沉默？（例如：24小时、3天）"

收集：silence_threshold

## 完成
写入记忆，告知已准备好开始跟进队列。
```

### 其余龙虾（Radar/Strategist/Inkwriter/Visualizer/Dispatcher/Abacus）

参考以上模板，各自聚焦自身职责：
- **Radar**：确认账号 + 需要监控的竞品账号名单
- **Strategist**：确认行业 + 当月核心 KPI（粉丝/GMV/曝光量）
- **Inkwriter**：确认账号 + 品牌语气（活泼/正式/感性）
- **Visualizer**：确认平台（决定内容规格）+ 视觉风格偏好
- **Dispatcher**：确认账号 + 最佳发布时间窗（早/午/晚）
- **Abacus**：确认归因周期（日报/周报/月报）+ 核心考核指标

---

## 四、新建 `dragon-senate-saas-v2/lobster_bootstrap.py`

```python
# lobster_bootstrap.py
# 龙虾 BOOTSTRAP 状态管理

# 功能：
#   1. check_bootstrap_status(lobster_id: str, session_id: str) → bool
#      检查该龙虾在该会话是否已完成 bootstrap
#
#   2. mark_bootstrap_complete(lobster_id: str, session_id: str, bootstrap_data: dict) → None
#      标记 bootstrap 完成，写入记忆
#      bootstrap_data 示例：
#      {
#        "account": "抖音@xx美食",
#        "industry": "餐饮",
#        "primary_goal": "涨粉",
#        "bootstrap_complete": True,
#        "bootstrap_at": "2026-04-02T01:00:00"
#      }
#
#   3. get_bootstrap_data(lobster_id: str, session_id: str) → dict | None
#      获取 bootstrap 数据（供龙虾运行时加载到上下文）
#
#   4. reset_bootstrap(lobster_id: str, session_id: str) → None
#      重置 bootstrap（管理员操作，用于账号切换）

# 存储：
#   bootstrap 状态写入 session 的 memory 层
#   复用 session_manager.py 的 session 存储

# 集成点：
#   lobster_runner.py 在执行前调用 check_bootstrap_status()
#   若未完成 bootstrap，加载该龙虾的 BOOTSTRAP.md 作为系统提示
#   若已完成，正常加载 SOUL.md + AGENTS.md
```

### 在 `lobster_runner.py` 集成

```python
# lobster_runner.py 中增加 bootstrap 检查：

from lobster_bootstrap import check_bootstrap_status, get_bootstrap_data

async def run_lobster(lobster_id, session_id, task, ...):
    bootstrap_done = await check_bootstrap_status(lobster_id, session_id)
    
    if not bootstrap_done:
        # 加载 BOOTSTRAP.md 作为首次运行提示
        bootstrap_prompt = load_bootstrap_md(lobster_id)
        system_prompt = bootstrap_prompt
    else:
        # 正常加载 SOUL.md + AGENTS.md
        bootstrap_ctx = get_bootstrap_data(lobster_id, session_id)
        system_prompt = build_system_prompt(lobster_id, extra_context=bootstrap_ctx)
    
    # ...正常执行
```

---

## 五、管理 API

```
GET  /api/v1/bootstrap/{session_id}/{lobster_id}      → 查询 bootstrap 状态
POST /api/v1/bootstrap/{session_id}/{lobster_id}/reset → 重置 bootstrap（管理员）
```

---

## 六、⚠️ 覆盖规则（重要）

1. **`packages/lobsters/lobster-*/AGENTS.md`** 中如有"首次使用说明"相关段落，**移入 BOOTSTRAP.md，从 AGENTS.md 中删除**，避免重复。

2. **`PROJECT_CONTROL_CENTER.md` 第一节**"Agent OS 文档内容仍偏薄"的 `🟡` 风险项：
   - BOOTSTRAP.md 完成后，将此风险项状态从 `🟡` 改为更具体的进度描述。

3. **第六节路线图**"Agent OS 内容深化"任务：
   - 打上 `[x]`（BOOTSTRAP 是 Agent OS 深化的重要组成部分）。

---

## 七、PROJECT_CONTROL_CENTER.md 同步更新

完成后更新 `PROJECT_CONTROL_CENTER.md`：

1. **第三节"当前成熟能力"** 增加：
   ```
   ✅ `lobster_bootstrap.py` 龙虾冷启动状态管理
   ✅ 10只龙虾各自 `BOOTSTRAP.md` 首次激活协议
   ```

2. **第六节 P0 路线图** 更新：
   ```
   [x] Agent OS 内容深化：10只龙虾 BOOTSTRAP.md 完成
   ```

3. **第七节"已落地借鉴清单"** 增加：
   ```
   | Aurogen | BOOTSTRAP 冷启动协议（2-3轮建立工作关系） | ✅ | lobster_bootstrap.py, packages/lobsters/*/BOOTSTRAP.md |
   ```

---

## 验收标准

- [ ] 10个 `packages/lobsters/lobster-*/BOOTSTRAP.md` 文件存在，各有角色专属内容
- [ ] `lobster_bootstrap.py` 实现完整（check/mark/get/reset 4个方法）
- [ ] `lobster_runner.py` 在执行前检查 bootstrap 状态，未完成时加载 BOOTSTRAP.md
- [ ] AGENTS.md 中重复的"首次使用说明"已移入 BOOTSTRAP.md 并从 AGENTS.md 删除
- [ ] 管理 API 2个端点可用
- [ ] `PROJECT_CONTROL_CENTER.md` 相关 `🟡` 已更新

---

*Codex Task | 来源：AUROGEN_BORROWING_ANALYSIS.md P1-#4 | 2026-04-02*
