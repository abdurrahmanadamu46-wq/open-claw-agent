# OpenClaw Agent（Liaoyuan / 龙虾元老院）

本仓库当前采用**统一控制面**：

- `web`（前端）
- `backend`（控制面 API）
- `dragon-senate-saas-v2`（AI 子服务，作为 backend 下游）

> `dragon-senate-saas-v2` 不再作为平行产品线对外暴露控制接口。

## 快速开始

```powershell
# 启动统一控制面
npm run module:up:control

# 查看状态
npm run module:ps
```

访问地址：

- Web: `http://127.0.0.1:3301`
- Backend: `http://127.0.0.1:48789`
- AI Subservice: `http://127.0.0.1:18000`

## 主干门禁（发版必须通过）

- GitHub workflow: `.github/workflows/mainline-gate.yml`
- 必过检查：
  - `contracts`
  - `week3-e2e-live`

## 模块化命令

```powershell
npm run module:help
npm run apps:help
npm run module:test:release
```

## 交接文档（新团队必读）

- `docs/handover/00-START-HERE.md`
- `docs/handover/01-REPO-MAP.md`
- `docs/handover/02-RUN-AND-VERIFY.md`
- `docs/handover/03-OPEN-ITEMS.md`
- `docs/handover/04-CODEX-CLAUDE-ONBOARDING.md`
- `docs/handover/handover_manifest.json`

可生成当前运行快照：

```powershell
npm run handover:snapshot
```

## 备份与存储

```powershell
# 代码同步到 F 盘备份目录
npm run backup:f:sync

# Docker 数据固定到 F 盘
npm run docker:data:f:pin
```

说明文档：`docs/DockerDesktop_默认数据目录固定到F盘.md`

