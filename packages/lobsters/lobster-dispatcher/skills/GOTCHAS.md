# Dispatcher Skill Gotchas

## dispatcher_task_split
- 拆任务时不要丢掉依赖关系和审批节点。
- 子任务命名要稳定，否则后续追踪会混乱。

## dispatcher_scheduled_publish
- 定时发布要校验时区，不要默认 UTC 直接发。
- 预发布时间窗要避开平台风控和人工审核空档。

## dispatcher_multi_account_rotate
- 账号轮转不能无视账号权重和历史风险状态。
- 同一素材不要短时间在多账号重复推送。

## dispatcher_emergency_takedown
- 紧急下架动作要保留审计和回滚信息。
- 不要把“低表现”误当成“高风险”直接下架。
