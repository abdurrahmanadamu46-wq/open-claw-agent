# XAI Scorer Service（金算虾线索评分与反事实解释）

让金算虾从「黑盒打分机」升级为**线索超级大脑**：不仅给出分数，还通过**反事实解释（Counterfactual XAI）** 说明差在哪里、补齐什么条件就能成交，形成可执行的挽回路径。

## 能力概览

- **线索打分**：基于内容关键词、互动深度、人设标签计算 0–100 分，≥80 为 Hot Lead 推送人工回访。
- **反事实解释**：对非 Hot 线索做特征扰动（高价值词替换、互动深度提升），寻找突破阈值的最小改变路径，并生成业务员可读的「挽回建议」（如：用回声虾发成分/售后诱饵话术测试反应）。

## 运行

```bash
pip install -r requirements.txt
cd xai-scorer-service && python -m uvicorn main:app --host 0.0.0.0 --port 8040
# 或
python main.py
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `XAI_HOST` / `XAI_PORT` | 监听地址与端口 | `0.0.0.0` / `8040` |

## API

- **POST /api/v1/scoring/analyze-lead**  
  - Body: `LeadFeature`（user_id, content, interaction_depth, persona_tag）  
  - 返回: `AnalyzedLeadResponse`（result: ScoringResult；explanation: CounterfactualExplanation 仅当非 Hot 时存在）

## 与业务联动

- **铁网虾**：意图识别后的线索特征传入本服务打分并拿解释。
- **SaaS CRM / 超级海港**：在线索卡片展示「金算虾评分 + XAI 分析」；业务员按「挽回建议」决定是否用回声虾下诱饵话术、或放弃跟进。
- **回声虾**：可根据解释中的 `minimal_changes_required`（如 content_keyword）调整回复策略，测试用户反应深度。

## Docker

```bash
docker build -t xai-scorer-service .
docker run -p 8040:8040 xai-scorer-service
```

## 扩展

- **core/knowledge_base.py**：生产可替换为 RAG 或嵌入向量，动态维护高转化词与羊毛词权重。
- **core/lead_scorer.py**：可接入 DeepSeek-V3 或 XGBoost 等模型，保留 `calculate_score` 接口不变。
