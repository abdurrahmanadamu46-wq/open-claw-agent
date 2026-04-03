# 自带技能的龙虾（Docker 部署）

在本机 Docker 中运行**一只自带技能的龙虾**：以 [OpenClaw](https://github.com/openclaw/openclaw) 为核心，集成 [CLI-Anything](https://github.com/HKUDS/CLI-Anything) 与 [RAG-Anything](https://github.com/HKUDS/RAG-Anything) 作为基础技能，实现多智能体、上下文学习与工具调用（参考《上下文至关重要：利用流程图模拟中的智能体人工智能实现基于模型的自主流程设计》）。

## 架构简述

- **龙虾池管理端**：现有 总控（Nest backend）+ 网页控制台，负责任务下发与设备管理。
- **本机龙虾**：本 Docker 栈运行的是 **OpenClaw Gateway + 技能**，可独立作为本地 AI 助手使用，也可在后续与总控对接（如通过 WebSocket / 激活码注册为节点）。

## 前置要求

- Docker、Docker Compose
- （可选）构建 OpenClaw 官方镜像以获得更完整功能：  
  `docker build -t openclaw:local https://github.com/openclaw/openclaw.git`  
  若使用该镜像，可修改 `Dockerfile` 第一行改为 `FROM openclaw:local` 并注释掉“方式二”的 Node 安装段落。

## 一键启动

在**仓库根目录**执行：

```bash
docker compose -f docker/lobster/docker-compose.yml up -d --build
```

或使用 Windows 批处理（仓库根目录双击）：

```
docker\lobster\启动龙虾Docker.bat
```

首次会构建镜像（含 Node、OpenClaw、Python、RAG-Anything 与内置技能），之后启动容器。Gateway 监听 **18789** 端口（可通过环境变量 `LOBSTER_GATEWAY_PORT` 修改）。

## 访问与使用（启动后「接下来怎么办」见 [使用说明_接下来怎么办.md](使用说明_接下来怎么办.md)）

- **控制台（推荐）**：浏览器打开 **http://localhost:18789/**，或双击 **`打开龙虾控制台.bat`**。
- **健康检查**：`http://localhost:18789/healthz`
- **技能**：  
  - **cli-anything**：让 OpenClaw 为指定软件或源码仓库生成/优化 CLI harness（与 CLI-Anything 方法论一致）。  
  - **rag-anything**：对 PDF、Office、图片等文档做多模态 RAG 建库与问答；需在环境中配置 `OPENAI_API_KEY`（或等价 base_url）以便调用 LLM/Embedding。

## 与总控的关系

- 当前为**独立运行**的“本机龙虾”，不依赖现有 总控。
- 若需接入龙虾池：总控侧使用 `/agent-cc` 或 `/lobster` 等 WebSocket 路径；本容器可后续扩展为通过激活码或 JWT 连接总控，作为池中一只可下发任务的节点。

## 目录说明

| 路径 | 说明 |
|------|------|
| `Dockerfile` | 以 OpenClaw 为核心，安装 Python、RAG-Anything，并写入 CLI-Anything / RAG-Anything 技能 |
| `docker-compose.yml` | 一键 up 的编排；端口、volume、环境变量可在此或 `.env` 中覆盖 |
| `skills/cli-anything/SKILL.md` | CLI-Anything 的 OpenClaw 技能描述（来源 HKUDS/CLI-Anything openclaw-skill） |
| `skills/rag-anything/SKILL.md` | RAG-Anything 的 OpenClaw 技能描述（文档 RAG / 多模态问答） |

## 参考

- [OpenClaw](https://github.com/openclaw/openclaw) — 个人 AI 助手核心
- [CLI-Anything](https://github.com/HKUDS/CLI-Anything) — 让任意软件 Agent-Native 的 CLI 生成
- [RAG-Anything](https://github.com/HKUDS/RAG-Anything) — 多模态文档 RAG 框架
