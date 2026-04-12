# 深色主题 UI — 已完成修改说明

## 结果概览

整站已改为**深色科技风**：背景 `#0F172A`，卡片/顶栏/侧栏 `#1E293B`，文字 `#F8FAFC` / `#94A3B8`，红金强调色保留。

## 修改文件一览

| 文件 | 修改要点 |
|------|----------|
| `src/app/globals.css` | `:root` 深色变量；`html, body { background: #0F172A !important; color: #F8FAFC !important; }`；`.claw-bg` / `.claw-surface` 等工具类带 `!important` |
| `src/app/layout.tsx` | `<html style={{ backgroundColor: '#0F172A' }}>`；`<body style={{ backgroundColor: '#0F172A', color: '#F8FAFC' }}>` |
| `src/components/layouts/AppShell.tsx` | 根容器 `style={{ backgroundColor: '#0F172A' }}` |
| `src/components/layouts/Header.tsx` | 顶栏 `backgroundColor: '#1E293B'`，标题/副文案内联颜色 |
| `src/components/layouts/Sidebar.tsx` | 侧栏 `backgroundColor: '#1E293B'`，Logo 链接颜色 |
| `src/app/page.tsx` | 大盘容器、卡片标题/数字、创建任务按钮等全部内联深色与红金色 |
| `src/components/ui/Card.tsx` | `backgroundColor: '#1E293B'`, `borderColor: 'rgba(255,255,255,0.1)'` |
| `src/components/ui/Skeleton.tsx` | `backgroundColor: 'rgba(255,255,255,0.12)'` |

## 你本地需要做的（必做）

1. **清缓存并重启**
   ```bash
   cd web
   rmdir /s /q .next
   npm run dev
   ```
   若没有 `.next` 可忽略删除步骤，直接 `npm run dev`。

2. **浏览器强刷**  
   Ctrl+Shift+R 或 Ctrl+F5。必要时在开发者工具 → Network 勾选「Disable cache」再刷新。

完成以上两步后，首页（数据大盘）、顶栏、侧栏应为深色背景 + 浅色字；若仍为浅色，请用 F12 看 `<html>` / `<body>` 的 computed 样式里 `background-color` 实际值并反馈。
