export const LEARNING_LOOP_ROUTES = {
  home: {
    href: '/',
    title: '首页轻量健康卡',
    description: '适合演示开场，先看学习闭环和主线健康度。',
  },
  tenantCockpit: {
    href: '/operations/tenant-cockpit',
    title: '租户 Cockpit',
    description: '适合租户级商业化验收和老板复盘。',
  },
  skillsImprovements: {
    href: '/operations/skills-improvements',
    title: 'Skill 进化闭环',
    description: '适合看真实信号、提案、diff、审批、apply、rollback 和效果追踪。',
  },
  memory: {
    href: '/operations/memory',
    title: '双轨记忆',
    description: '适合知识层负责人和 QA 核对 resident / history / source chain。',
  },
  releaseChecklist: {
    href: '/operations/release-checklist',
    title: 'QA 最终勾选清单',
    description: '适合发布前收尾联调和最终 Go / Canary / No-Go 口径。',
  },
  acceptance: {
    href: '/operations/learning-loop-acceptance',
    title: '学习闭环验收说明',
    description: '适合 QA、项目总控和 AI 员工按步骤执行验收。',
  },
  report: {
    href: '/operations/learning-loop-report',
    title: '老板汇报版',
    description: '适合一屏讲清学习闭环当前状态、风险、建议和下一步。',
  },
  projectCloseout: {
    href: '/operations/project-closeout',
    title: '项目总收口页',
    description: '适合从项目层面查看主入口、学习闭环、QA 验收、老板汇报和仓库交接是否已经收口。',
  },
  deliveryHub: {
    href: '/operations/delivery-hub',
    title: '最终交付导航页',
    description: '适合 QA、项目总控、老板和接手同学统一查看最新自动证据、交付入口和使用顺序。',
  },
  frontendGaps: {
    href: '/operations/frontend-gaps',
    title: '前端联调辅助总表',
    description: '适合 QA、前端和集成工程师对齐入口边界、联调风险、contract 缺口和推进顺序。',
  },
} as const;
