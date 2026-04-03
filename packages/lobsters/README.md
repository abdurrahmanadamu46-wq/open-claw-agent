# Lobster Role Packages

这组目录是 OpenClaw 统一运行时的 10 个角色面具（masks）配置包。

设计原则：**单一运行时，多角色面具。** 运行时按需加载角色配置，共享企业记忆，无信息孤岛。

目标：

- 让每个角色的技能库持续强化（通过统一 battle log → skills_v3 回填）
- 让 Commander 角色继续统一编排和路由
- 让评测、样本、记忆、playbook 有独立 ownership

当前角色包：

- `lobster-radar`
- `lobster-strategist`
- `lobster-inkwriter`
- `lobster-visualizer`
- `lobster-dispatcher`
- `lobster-echoer`
- `lobster-catcher`
- `lobster-abacus`
- `lobster-followup`

统一模板文档：

- `docs/architecture/LOBSTER_SUBPROJECT_TEMPLATE_v0.1.md`
