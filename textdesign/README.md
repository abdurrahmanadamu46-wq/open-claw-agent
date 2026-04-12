# ClawCommerce 设计交付库 (UI/UX Designer)

- **设计规范**：Figma 级文字原型 + Shadcn/UI + Tailwind + Radix + 暗黑模式
- **目标**：配置→启动→查看线索 ≤3 步，视觉评分 ≥9.5，移动端线索页 100% 可用

## 目录

| 目录 | 说明 |
|------|------|
| `prototypes/` | 高保真文字原型 Markdown（可导入 Figma AI 或手动还原） |
| `components/` | 组件代码（可直接复制到 `web/src/components`） |
| `design-system/` | Tokens、颜色、字体、暗黑/亮色 |
| `user-journey/` | 用户旅程图（Mermaid）、A/B 测试计划、可用性脚本 |

## 使用方式

1. 先读 `design-system/tokens.md` 与对应页面 `prototypes/*.md`
2. 将 `components/` 下组件复制到 `web/src/components`，按需调整 import
3. 所有数据来自 `web/src/services/`，禁止硬编码业务数据
