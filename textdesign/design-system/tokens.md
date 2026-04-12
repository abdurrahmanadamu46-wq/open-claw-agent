# ClawCommerce Design System — Tokens

## 主色与语义色

| Token | Light | Dark | 用途 |
|-------|--------|------|------|
| `--primary` | #3B82F6 | #60A5FA | 主按钮、链接、选中 |
| `--primary-foreground` | #FFFFFF | #0F172A | 主按钮文字 |
| `--background` | #FFFFFF | #0F172A | 页面背景 |
| `--foreground` | #0F172A | #F8FAFC | 正文 |
| `--muted` | #F1F5F9 | #1E293B | 卡片/次要背景 |
| `--muted-foreground` | #64748B | #94A3B8 | 辅助文案 |
| `--border` | #E2E8F0 | #334155 | 边框 |
| `--success` | #22C55E | #4ADE80 | 成功、健康 |
| `--warning` | #EAB308 | #FACC15 | 告警、进行中 |
| `--destructive` | #EF4444 | #F87171 | 终止、错误 |

## 节点状态色（大盘/任务）

| 状态 | 色值 | 含义 |
|------|------|------|
| 健康/空闲 | `--success` | 绿 |
| 运行中/采集中 | `--primary` | 蓝 |
| 告警/冷却 | `--warning` | 黄 |
| 异常/封禁 | `--destructive` | 红 |

## 字体

- **无衬线**：Inter, system-ui, sans-serif（数字/英文）；PingFang SC / 微软雅黑（中文）
- **等宽**：JetBrains Mono, monospace（ID、日志）
- **标题**：font-semibold / font-bold；正文：font-normal；辅助：text-sm + muted-foreground

## 圆角与阴影

- 卡片/输入：`rounded-lg` (8px)
- 按钮：`rounded-md` (6px)
- 标签：`rounded-full`
- 卡片阴影：`shadow-sm` 默认，hover `shadow-md`

## 暗黑模式

- 使用 `next-themes`，class 策略：`class="dark"` 挂于 `<html>`
- 所有组件通过 Tailwind `dark:` 前缀适配，无硬编码色值
