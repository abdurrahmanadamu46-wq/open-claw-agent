# 后端工程师任务书 — dragon-senate-saas-v2 主线同步

> 发布日期：2026-04-03  
> 负责人：后端工程师  
> 目标：把工作区 226 个 Python 文件中尚未合并到 `main@0633224` 的模块逐批提交到主线，并补齐 2 个真正缺失的 P1/P2 能力。  
> 汇报方式：每完成一个批次，在仓库根目录更新 `PROJECT_CONTROL_CENTER.md`，把对应 🔵 改为 ✅，然后发消息 "Batch N 合并完成，已更新 PCC"。

---

## 背景

当前 `main@0633224` 停在 `feat(P1): wire audit_logger`。工作区已有 226 个 Python 文件，但 git 只跟踪了极少数。这意味着：
- 所有 🔵 模块**代码已存在于工作目录**，不需要重写，只需 `git add + commit`
- 真正需要编写新代码的只有下方标注 ⚠️ 的 2 个条目

---

## 任务一：Batch 合并（代码已存在，只需 commit）

### Batch 1 — 基础设施层（优先级最高，阻塞其他人）

**为什么先做**：`failover_provider.py` 是所有 LLM 调用的可靠性保障；`feature_flags.py` 控制灰度开关；`langfuse_tracer.py` 是可观测性基础。其他团队成员的任务依赖这些。

**操作步骤**：
```bash
cd F:/openclaw-agent/dragon-senate-saas-v2

git add failover_provider.py
git add feature_flags.py
git add edge-runtime/feature_flag_proxy.py   # 注意：在 edge-runtime 子目录
git add langfuse_tracer.py observability_api.py
git add context_engine.py
git add provider_registry.py

git commit -m "feat(P1-batch1): merge failover_provider, feature_flags, langfuse_tracer, context_engine from workspace"
```

**验证**：
```bash
python -c "from failover_provider import FailoverProvider; print('OK')"
python -c "from feature_flags import FeatureFlagSystem; print('OK')"
python -c "from langfuse_tracer import LangfuseTracer; print('OK')"
python -c "from context_engine import ContextEngine; print('OK')"
```

**同步 PCC**：把 PCC 文件中这 5 个模块的 🔵 改为 ✅。

---

### Batch 2 — 商业化核心

**文件**：
```bash
git add saas_billing.py saas_pricing_model.py
git add enterprise_onboarding.py
git add campaign_lifecycle_manager.py
git add tool_marketplace.py
git add regional_agent_system.py
git add seat_quota_tracker.py seat_subscription_service.py
git add payment_gateway.py billing.py

git commit -m "feat(P1-batch2): merge saas_billing, pricing, onboarding, campaign_lifecycle, marketplace"
```

**验证**：
```bash
python -c "from saas_billing import SaaSBilling; print('OK')"
python -c "from saas_pricing_model import SaaSPricingModel; print('OK')"
python -c "from enterprise_onboarding import EnterpriseOnboarding; print('OK')"
```

---

### Batch 3 — 运行时扩展能力

**文件**：
```bash
git add services/lobster-memory/   # Hybrid Search 整个目录
git add lobster_pool_manager.py
git add lobster_task_dag.py lobster_mailbox.py
git add lobster_circuit_breaker.py lobster_task_waiter.py
git add lobster_clone_manager.py lobster_evolution_engine.py
git add lobster_voice_style.py lobster_im_channel.py
git add lobster_session.py

git commit -m "feat(P2-batch3): merge lobster runtime extensions - pool, dag, mailbox, circuit_breaker, clone, evolution"
```

**验证**：
```bash
python -c "from lobster_task_dag import LobsterTaskDAG; print('OK')"
python -c "from lobster_circuit_breaker import CircuitBreaker; print('OK')"
```

---

### Batch 4 — 行业知识与增长

**文件**：
```bash
git add industry_insight_store.py industry_kb_pool.py
git add industry_kb_bulk_seed.py industry_kb_profile_generator.py
git add industry_starter_kit.py industry_taxonomy.py industry_workflows.py
git add growth_strategy_engine.py
git add customer_mind_map.py

git commit -m "feat(P2-batch4): merge industry KB, growth strategy engine, customer mind map"
```

---

### Batch 5 — 平台治理与杂项

**文件**：
```bash
git add platform_governance.py
git add tenant_memory_sync.py
git add skill_frontmatter.py skill_manifest_loader.py skill_publish_policy.py
git add artifact_store.py artifact_validator.py
git add video_composer.py
git add im_media_pipeline.py media_cost_optimizer.py media_post_pipeline.py
git add lobster_output_schemas.py lobster_output_validator.py
git add dynamic_config.py

git commit -m "feat(P2-batch5): merge platform governance, tenant sync, skill frontmatter, artifact store, media pipeline"
```

---

### Batch 6 — 剩余业务模块

**文件**（全部加入）：
```bash
git add activity_stream.py agent_commission_service.py
git add agent_extension_registry.py agent_model_registry.py
git add agent_rag_pack_factory.py agent_tier_manager.py
git add annotation_sync.py approval_gate.py
git add clawrouter_gateway.py clawteam_inbox.py clawwork_economy.py
git add cloud_brain_registry.py comfyui_adapter.py comfyui_capability_matrix.py
git add constitutional_policy.py coordinator_protocol.py
git add dingtalk_channel.py feishu_channel.py telegram_bot.py
git add edge_resource_governor.py edge_rewards.py
git add followup_subagent_store.py lossless_memory.py memory_governor.py
git add multimodal_rag_adapter.py notification_center.py otp_relay.py
git add policy_bandit.py sub_agent_manager.py
git add research_radar_fetchers.py research_radar_ranker.py research_radar_store.py
git add task_idempotency_lock.py task_resolution.py
git add vllm_provider.py white_label_service.py
git add workflow_converter.py workflow_template_catalog.py workflow_template_registry.py

git commit -m "feat(P2-batch6): merge remaining business modules - channels, media, research, governance"
```

---

## 任务二：⚠️ 真正需要新增的代码（P1 + P2 缺口）

### 2A — 接通 `skill_effectiveness_calibrator.py` 到路由 ⚠️

**现状**：`skill_effectiveness_calibrator.py` **文件已存在于工作区**，但 `app.py` 中没有注册对应的 API 路由。

**需要修改**：`F:/openclaw-agent/dragon-senate-saas-v2/app.py`

**找到位置**：搜索 `POST /api/skills/calibrate`，如果不存在，在 `/api/skills` 路由区块附近添加：

```python
# 在 app.py 中 import 区块添加：
from skill_effectiveness_calibrator import SkillEffectivenessCalibrator

# 在路由注册区添加（搜索 "api/skills" 附近）：
@app.post("/api/v1/skills/calibrate")
async def calibrate_skill_effectiveness(
    reward_history: list[dict] = Body(...),
    _: dict = Depends(require_auth),
):
    calibrator = SkillEffectivenessCalibrator()
    result = calibrator.calibrate_from_rewards(reward_history)
    return result
```

**验证**：
```bash
cd F:/openclaw-agent/dragon-senate-saas-v2
python -c "import app; print('routes OK')"
# 启动后：curl -X POST http://localhost:8000/api/v1/skills/calibrate -H "Content-Type: application/json" -d '[]'
# 应返回 {"calibrated": 0, "skills": {}}
```

---

### 2B — 接通 `skill-registry-service` 到部署 ⚠️

**现状**：`F:/openclaw-agent/services/skill-registry-service/` 目录已存在，有 `main.py` + `skill_scanner.py` + `requirements.txt`，但没有加入 `docker-compose.yml`。

**需要修改**：`F:/openclaw-agent/docker-compose.yml`（或 `docker-compose.dev.yml`）

在现有服务列表中添加：
```yaml
  skill-registry:
    build: ./services/skill-registry-service
    ports:
      - "8050:8050"
    environment:
      - DRAGON_SENATE_URL=http://app:8000
    depends_on:
      - app
    restart: unless-stopped
```

**验证**：
```bash
cd F:/openclaw-agent
docker compose up skill-registry -d
curl http://localhost:8050/healthz
# 应返回 {"ok": true, "service": "skill-registry-service"}
curl "http://localhost:8050/skills?enabled_only=true"
```

**合并**：
```bash
git add services/skill-registry-service/
git add docker-compose.yml   # 或 docker-compose.dev.yml
git commit -m "feat(P2): wire skill-registry-service into compose + connect skill_effectiveness_calibrator route"
```

---

## 汇报格式

每完成一个 Batch，发以下格式消息给总工：

```
Batch N 合并完成
- 文件数：XX 个
- commit：<hash>
- 验证结果：全部通过 / [具体错误]
- PCC 已更新：🔵→✅ [模块名列表]
- 下一步：准备 Batch N+1
```

如遇到 import 错误或依赖缺失，附上完整报错，不要跳过。
