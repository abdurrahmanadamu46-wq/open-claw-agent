# 自带技能的龙虾 — OpenClaw 核心 + CLI-Anything / RAG-Anything 技能
# 理论参考：上下文至关重要（多智能体、上下文学习、工具调用）
# 构建：在仓库根目录 docker build -f docker/lobster/Dockerfile -t lobster-openclaw:local .
# 方式一：基于已构建的 OpenClaw 镜像（推荐先执行 docker build -t openclaw:local https://github.com/openclaw/openclaw.git）
# 方式二：使用下方「无 openclaw 镜像」分支，通过 npm 安装 OpenClaw

# ========== 方式一：基于官方 OpenClaw 镜像（取消下一行注释并注释掉方式二） ==========
# FROM openclaw:local

# ========== 方式二：从 Node 安装 OpenClaw（无官方镜像时使用） ==========
ARG NODE_VER=24
FROM node:${NODE_VER}-bookworm AS runtime
WORKDIR /app

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    procps curl git openssl python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# 全局安装 OpenClaw（含 Gateway）
RUN npm install -g openclaw@latest

# 安装 RAG-Anything（技能通过 bash 调用）
RUN pip3 install --break-system-packages --no-cache-dir raganything 2>/dev/null || true

# 内置技能与 Control UI 配置（非 loopback 绑定时必须，否则 Gateway 启动报错）
RUN mkdir -p /home/node/.openclaw/workspace/skills
COPY docker/lobster/skills/cli-anything /home/node/.openclaw/workspace/skills/cli-anything
COPY docker/lobster/skills/rag-anything /home/node/.openclaw/workspace/skills/rag-anything
COPY docker/lobster/openclaw.json /home/node/.openclaw/openclaw.json
RUN chown -R node:node /home/node

ENV NODE_ENV=production
ENV HOME=/home/node
USER node

EXPOSE 18789
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:18789/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 0
CMD ["openclaw", "gateway", "--bind", "lan", "--port", "18789", "--allow-unconfigured"]
