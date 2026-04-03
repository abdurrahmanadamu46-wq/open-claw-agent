# Trust Verification Service（零信任安全审计）

行为剧本与边缘环境的「机器特征排雷」微服务：**前置**校验行为生物学指纹 (BBP)，**后置**校验环境指纹与轨迹真实度。与业务逻辑解耦，仅内网暴露。

## 部署原则

- **内网隔离**：服务不暴露公网，仅 VPC 内由 **点兵虾 (Dispatcher)** 与 **边缘数据接入网关 (WSS Hub)** 调用。
- **熔断重试**：当 `/api/v1/verify/pre-execution` 返回 `is_safe=False` 时，抓取 `reason` 回传 Behavior Engine，要求「增加约 20% 高斯噪声延迟并重试」。
- **金算虾联动**：仅当后置审计返回 `action_taken=SETTLE_REWARD` 时，才向 SaaS CRM / 金算虾触发虾粮结算；否则可 BAN_NODE / 扣减奖励。

## 运行

```bash
pip install -r requirements.txt
cd trust-verification-service && python -m uvicorn main:app --host 0.0.0.0 --port 8020
# 或
python main.py
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `VERIFY_HOST` / `VERIFY_PORT` | 监听地址与端口 | `0.0.0.0` / `8020` |

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/verify/pre-execution` | 下发前审计：Body `BehaviorPlan`，返回 `VerificationResult` |
| POST | `/api/v1/verify/post-execution` | 执行后审计：Body `TelemetryData`，返回 `VerificationResult` |

### 前置审计规则（简要）

- **方差检测**：若步骤延迟方差 < 0.05（过于匀速），判定机器特征 → `BLOCK_AND_REGENERATE`。
- **频率阈值**：like/comment 次数 per 总时长 > 0.5 视为超出人类阅读极限 → `BLOCK_AND_REGENERATE`。

### 后置审计规则（简要）

- **WebDriver**：`webdriver_present=true` → `BAN_NODE_AND_CONFISCATE_REWARD`。
- **Canvas 黑名单**：指纹命中已知云手机/虚拟机 → `BAN_NODE`。
- **轨迹方差**：`mouse_trajectory_variance < 0.01` → `FLAG_NODE_FOR_REVIEW`。

## Docker

```bash
docker build -t trust-verification-service .
docker run -p 8020:8020 trust-verification-service
```

## 扩展

- **core/ml_models.py**：可接入 Isolation Forest 等轻量异常检测模型，对延迟/时长/轨迹特征做异常分，与现有规则引擎并联使用。
