# 07-HANDOVER-CHECKLIST（交接检查清单）

Last Updated: 2026-03-26

## A. 环境与启动
- [ ] 已进入仓库根目录
- [ ] `npm run module:up:control` 成功
- [ ] `npm run module:ps` 显示核心服务 Up/healthy

## B. 基础连通性
- [ ] Web: `http://127.0.0.1:3301` 可打开
- [ ] Backend: `http://127.0.0.1:48789/autopilot/status` 返回正常
- [ ] AI: `http://127.0.0.1:18000/healthz` 返回正常

## C. 鉴权与主链
- [ ] `admin/change_me` 登录成功
- [ ] 受保护 API 调用成功
- [ ] release 回归通过（`npm run module:test:release`）

## D. 文档与状态同步
- [ ] `PROJECT_STATE.md` 已更新日期与状态
- [ ] `COMMERCIALIZATION_SCORE.md` 已更新评分依据
- [ ] `BACKLOG.md` 已更新优先级任务
- [ ] `SKIP_TEMP.md` 已同步真实阻塞项
- [ ] `docs/handover/handover_manifest.json` 已更新

## E. 交接质量门槛
- [ ] 不存在“只展示不联动”的新增页面
- [ ] 新增高风险动作都有 HITL 审批链
- [ ] 关键动作可审计、可回滚、可复盘

## F. 备份与留档
- [ ] 已执行 `npm run backup:f:sync`
- [ ] 已记录本轮变更文件与验证命令
- [ ] 已在 `03-OPEN-ITEMS.md` 标注下一位接手起点
