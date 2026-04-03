# 全栈/运维工程师任务书 — 部署流水线 + P0 内容资产

> 发布日期：2026-04-03  
> 负责人：全栈/运维工程师  
> 目标：打通 Docker 部署链路、完成 9 只业务虾的 Prompt 资产标准化、补齐策略强度历史 API。  
> 汇报方式：每完成一项，更新 `PROJECT_CONTROL_CENTER.md` 对应状态，发消息 "任务N 完成，commit: <hash>"。

---

## 背景

这份任务书涵盖三个方向：
1. **运维**：让 docker-compose 能一键拉起全栈（当前 `skill-registry-service` 没有加入 compose，部署流程不完整）
2. **内容**：P0 还有 2 个未完成项是内容资产（不是代码）——9 只业务虾的 Prompt 标准化
3. **后端轻量补齐**：策略强度历史 API（代码框架已存在，只需加 1 个路由）

---

## 任务一：Docker Compose 完整化（运维）

### 1A — 确认当前 compose 状态

```bash
cd F:/openclaw-agent
cat docker-compose.yml | grep "services:" -A 5
# 看当前有哪些服务
docker compose ps   # 看哪些在跑
```

### 1B — 加入 `skill-registry-service`

打开 `F:/openclaw-agent/docker-compose.yml`（或 `docker-compose.dev.yml`），在现有服务列表后追加：

```yaml
  skill-registry:
    build:
      context: ./services/skill-registry-service
      dockerfile: Dockerfile
    ports:
      - "8050:8050"
    environment:
      - DRAGON_SENATE_URL=http://app:8000
    depends_on:
      - app
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8050/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
```

如果 `services/skill-registry-service/Dockerfile` 不存在，创建它：

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8050
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8050"]
```

检查 `F:/openclaw-agent/services/skill-registry-service/requirements.txt` 是否包含：
```
fastapi
uvicorn
httpx
pydantic
```
如果缺失，补充进去。

**验证**：
```bash
cd F:/openclaw-agent
docker compose build skill-registry
docker compose up skill-registry -d
curl http://localhost:8050/healthz
# 预期: {"ok": true, "service": "skill-registry-service"}
curl "http://localhost:8050/skills"
# 预期: {"skills": [...]} 或空列表
```

### 1C — 验证全栈一键启动

```bash
cd F:/openclaw-agent
docker compose up -d
# 等待 30 秒
curl http://localhost:8000/healthz     # FastAPI
curl http://localhost:3000/api/health  # NestJS（如有）
curl http://localhost:3001             # Next.js（如在 compose 中）
curl http://localhost:8050/healthz     # skill-registry
```

所有服务都 200 则通过。

**提交**：
```bash
git add docker-compose.yml
git add services/skill-registry-service/Dockerfile
git commit -m "ops: add skill-registry-service to docker compose with healthcheck"
```

---

## 任务二：9 只业务虾 Prompt 资产标准化（P0 内容）

### 背景

9 只业务虾各自目录在 `F:/openclaw-agent/packages/lobsters/lobster-{id}/`，目录结构应为：
```
lobster-radar/
  role-card.json      ✅ 已存在
  SOUL.md             🟡 需深化
  AGENTS.md           🟡 需深化
  BOOTSTRAP.md        ✅ 已存在
  prompts/
    prompt-catalog.json   ← 这个是重点
    system-prompt.md
    user-template.md
```

### 检查现状

```bash
ls F:/openclaw-agent/packages/lobsters/
# 列出所有龙虾目录

for lobster in radar strategist inkwriter visualizer dispatcher echoer catcher abacus followup; do
  echo "=== $lobster ==="
  ls F:/openclaw-agent/packages/lobsters/lobster-$lobster/prompts/ 2>/dev/null || echo "prompts/ 目录不存在"
done
```

### 每只虾需要完成的内容

**针对每只虾**，在其 `prompts/` 目录下确保存在以下文件：

#### `prompt-catalog.json` 格式（以 inkwriter 为例）：
```json
{
  "lobster_id": "inkwriter",
  "version": "1.0.0",
  "prompts": [
    {
      "id": "copy_generate",
      "name": "主文案生成",
      "trigger": "需要生成短视频文案或图文话术时",
      "template": "你是吐墨虾，专业文案创作者。任务：{task_description}。行业：{industry}。平台：{platform}。要求：{requirements}",
      "variables": ["task_description", "industry", "platform", "requirements"],
      "effectiveness": {"overall": 4, "by_industry": {}}
    },
    {
      "id": "compliance_rewrite",
      "name": "合规改写",
      "trigger": "内容需要合规检查或敏感词处理时",
      "template": "你是吐墨虾。对以下内容进行合规检查和改写，确保符合{platform}平台规范：\n\n{original_content}",
      "variables": ["platform", "original_content"],
      "effectiveness": {"overall": 4, "by_industry": {}}
    }
  ]
}
```

**每只虾最少 2 个 prompt，对应其核心职责**：

| 龙虾 | 核心 prompt 1 | 核心 prompt 2 |
|---|---|---|
| radar | 信号发现扫描 | 热点分析报告 |
| strategist | 策略规划 | 排期制定 |
| inkwriter | 文案生成 | 合规改写 |
| visualizer | 分镜脚本 | 图片提示词 |
| dispatcher | 发布计划 | 时间窗优化 |
| echoer | 评论回复 | 私信承接 |
| catcher | 线索评分 | CRM 入库指令 |
| abacus | ROI 报告 | 归因分析 |
| followup | 跟进话术 | 唤醒方案 |

### 提交格式

每只虾完成后单独 commit：
```bash
git add packages/lobsters/lobster-radar/prompts/
git commit -m "content(P0): radar lobster prompt catalog - signal scan + trend analysis"

git add packages/lobsters/lobster-inkwriter/prompts/
git commit -m "content(P0): inkwriter lobster prompt catalog - copy generate + compliance rewrite"
# ... 依此类推
```

**验证**：
```bash
# 验证 JSON 格式合法
for lobster in radar strategist inkwriter visualizer dispatcher echoer catcher abacus followup; do
  python -m json.tool F:/openclaw-agent/packages/lobsters/lobster-$lobster/prompts/prompt-catalog.json > /dev/null && echo "$lobster: OK" || echo "$lobster: JSON ERROR"
done
```

---

## 任务三：策略强度历史 API（轻量后端补齐）

### 现状

`F:/openclaw-agent/web/src/services/endpoints/ai-subservice.ts` 中已有：
```typescript
export async function fetchStrategyIntensityHistory(tenantId?: string, limit = 20) { ... }
```
但后端 `app.py` 中这个路由可能不完整。

### 操作

1. 先检查：
```bash
grep -n "intensity.*history\|strategy.*history" F:/openclaw-agent/dragon-senate-saas-v2/app.py
```

2. 如果找不到对应路由，在 `app.py` 中找到 `intensity` 路由区块，添加：

```python
@app.get("/api/strategy/intensity/history")
async def get_strategy_intensity_history(
    tenant_id: str = Query(default="tenant_main"),
    limit: int = Query(default=20, le=100),
    _: dict = Depends(require_auth),
):
    """返回策略强度历史变更记录"""
    # strategy_intensity 数据存在 SQLite
    from strategy_intensity import get_intensity_history  # 按实际模块名调整
    history = get_intensity_history(tenant_id=tenant_id, limit=limit)
    return {"history": history, "tenant_id": tenant_id}
```

3. 如果 `strategy_intensity.py` 或对应函数不存在，用最简单的 SQLite 查询：
```python
@app.get("/api/strategy/intensity/history")
async def get_strategy_intensity_history(
    tenant_id: str = Query(default="tenant_main"),
    limit: int = Query(default=20, le=100),
):
    # 直接从 audit log 里查策略变更事件
    conn = get_db_connection()  # 用项目现有的 DB 连接方式
    rows = conn.execute(
        "SELECT * FROM strategy_intensity_log WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?",
        (tenant_id, limit)
    ).fetchall()
    return {"history": [dict(r) for r in rows]}
```

**验证**：
```bash
curl "http://localhost:8000/api/strategy/intensity/history?tenant_id=tenant_main"
# 返回 {"history": [...]} 即通过，空列表也可以
```

**提交**：
```bash
git add dragon-senate-saas-v2/app.py
git commit -m "feat(P1): add strategy intensity history API endpoint"
```

完成后在 PCC 把 `策略强度历史 API` 从 `[ ]` 改为 `[x]`。

---

## 汇报格式

```
任务N 完成
- 操作：<简述>
- commit：<hash>
- 验证命令 + 结果：<粘贴输出>
- PCC 已更新：<条目>
- 阻塞/问题：<如有>
```

**特别注意**：Prompt 内容任务不需要改代码，只需要创建 JSON 文件，但每个文件提交前必须通过 `python -m json.tool` 验证 JSON 合法。
