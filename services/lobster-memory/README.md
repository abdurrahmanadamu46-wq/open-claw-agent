# LobsterMemoryEngine — 弹性记忆模块

让边缘设备拥有「连贯的灵魂」：按 `node_id` / `persona_id` 硬隔离的记忆向量存储 + 时间与奖励动态衰减重排。

## 技术栈

- **Qdrant**：向量库，Payload 级强过滤（十万级设备极速隔离）
- **BAAI/bge-m3**：本地多语言 Embedding，1024 维
- **FastAPI**：REST 微服务，供 NestJS / 9 大 Agent 调用

## 本地开发

```bash
# 1. 启动 Qdrant（与调度中心同机房）
docker run -p 6333:6333 qdrant/qdrant

# 2. 安装依赖（首次会下载 BGE-M3 模型，约 2GB）
pip install -r requirements.txt

# 3. 启动服务
QDRANT_HOST=localhost QDRANT_PORT=6333 uvicorn main:app --reload --port 8000
```

## API

- `POST /memory/store` — 写入经历（node_id, intent, context_data, reward, persona_id?）
- `POST /memory/retrieve` — 检索自适应记忆（node_id, current_task, top_k, persona_id?）
- `GET /health` / `GET /healthz` — 健康检查（compression 路由可用时仍返回 ok，向量引擎异常时标记 degraded）
- `POST /compress/l0-to-l1` — L0 原始对话压缩成 L1 结构化报告
- `POST /compress/l1-to-l2` — L1 报告批次提炼成 L2 抽象知识
- `GET /compress/stats?tenant_id=tenant_main` — 返回与 runtime 一致的三层压缩统计

## 与 Behavior Engine 串联

Intent Engine 在为边缘节点下发任务前，可调用 `retrieve_adaptive_memory`。  
召回的记忆可作为「潜意识」注入 Prompt 或行为状态机，使生成的动作具有历史延续性（拟人度提升）。  
详见后端 `backend/src/memory/` 的 NestJS 客户端与 `BehaviorEngineService` 可选接入。
