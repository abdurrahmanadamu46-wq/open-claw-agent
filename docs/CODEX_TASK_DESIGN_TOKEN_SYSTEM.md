# CODEX TASK: 前端设计系统 — Design Token + Semantic Token
> 优先级：P0 | 来源：chakra-ui/chakra-ui styled-system
> 目标：建立统一的设计语言基础，消除页面间散落的手写颜色和样式

---

## 任务背景

当前问题：
- operations/* 页面各自手写颜色、间距、阴影，没有统一规范
- dark/light 模式切换困难（颜色不语义化）
- 新增页面需要反复参考老页面"抄"样式
- 多人协作时"产品语言"不统一

来源借鉴：chakra-ui v3 的 `styled-system/` 中的 `token-dictionary.ts` + `css-var.ts` + `conditions.ts`

---

## 目标产物

```
src/design-system/tokens/
├── colors.ts       ← 原始色板 + 语义色
├── spacing.ts      ← 间距 scale
├── typography.ts   ← 字号/字重/行高
├── shadows.ts      ← 阴影 scale
├── radii.ts        ← 圆角
├── semantic.ts     ← 语义 token（引用上面的原始色）
└── index.ts        ← 统一导出
```

---

## 实现规范

### 1. colors.ts — 原始色板 + 语义色

```typescript
// src/design-system/tokens/colors.ts

// ── 原始色板（不直接用于组件，只被 semantic.ts 引用）──────────────────
export const rawColors = {
  // Brand（主色）
  brand50:  '#f0f9ff',
  brand100: '#e0f2fe',
  brand200: '#bae6fd',
  brand300: '#7dd3fc',
  brand400: '#38bdf8',
  brand500: '#0ea5e9',   // 主要行动色
  brand600: '#0284c7',
  brand700: '#0369a1',
  brand800: '#075985',
  brand900: '#0c4a6e',

  // Neutral（灰阶）
  gray50:  '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray600: '#4b5563',
  gray700: '#374151',
  gray800: '#1f2937',
  gray900: '#111827',

  // Success
  green50:  '#f0fdf4',
  green500: '#22c55e',
  green700: '#15803d',

  // Warning
  amber50:  '#fffbeb',
  amber500: '#f59e0b',
  amber700: '#b45309',

  // Danger
  red50:  '#fef2f2',
  red500: '#ef4444',
  red700: '#b91c1c',

  // Info
  blue50:  '#eff6ff',
  blue500: '#3b82f6',
  blue700: '#1d4ed8',

  // Pure
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
} as const;

// ── 状态颜色（龙虾/任务状态专用）────────────────────────────────────────
export const statusColors = {
  running:    rawColors.blue500,
  completed:  rawColors.green500,
  failed:     rawColors.red500,
  paused:     rawColors.amber500,
  pending:    rawColors.gray400,
  backgrounded: rawColors.brand500,
  cancelled:  rawColors.gray500,
} as const;

export type StatusColor = keyof typeof statusColors;
```

### 2. semantic.ts — 语义 Token（核心！）

```typescript
// src/design-system/tokens/semantic.ts
// 语义 token 才是组件真正使用的颜色
// 好处：light/dark 模式只需在这里切换，组件代码不改

import { rawColors } from './colors';

export const semanticTokens = {
  colors: {
    // ── Surface（背景层级）────────────────────────
    'surface.page':        { light: rawColors.gray50,   dark: rawColors.gray900 },
    'surface.card':        { light: rawColors.white,    dark: rawColors.gray800 },
    'surface.overlay':     { light: rawColors.white,    dark: rawColors.gray700 },
    'surface.muted':       { light: rawColors.gray100,  dark: rawColors.gray800 },
    'surface.hover':       { light: rawColors.gray100,  dark: rawColors.gray700 },
    'surface.selected':    { light: rawColors.brand50,  dark: rawColors.brand900 },

    // ── Text（文字层级）──────────────────────────
    'text.primary':        { light: rawColors.gray900,  dark: rawColors.gray50  },
    'text.secondary':      { light: rawColors.gray600,  dark: rawColors.gray400 },
    'text.muted':          { light: rawColors.gray400,  dark: rawColors.gray500 },
    'text.on-brand':       { light: rawColors.white,    dark: rawColors.white   },
    'text.link':           { light: rawColors.brand600, dark: rawColors.brand300 },
    'text.danger':         { light: rawColors.red700,   dark: rawColors.red500  },

    // ── Border（边框）────────────────────────────
    'border.default':      { light: rawColors.gray200,  dark: rawColors.gray700 },
    'border.strong':       { light: rawColors.gray300,  dark: rawColors.gray600 },
    'border.focus':        { light: rawColors.brand500, dark: rawColors.brand400 },
    'border.danger':       { light: rawColors.red500,   dark: rawColors.red500  },

    // ── Brand（主色动作）─────────────────────────
    'brand.default':       { light: rawColors.brand500, dark: rawColors.brand400 },
    'brand.hover':         { light: rawColors.brand600, dark: rawColors.brand300 },
    'brand.subtle':        { light: rawColors.brand50,  dark: rawColors.brand900 },

    // ── Status（任务/龙虾状态）──────────────────
    'status.running.bg':   { light: rawColors.blue50,   dark: '#1e3a5f' },
    'status.running.text': { light: rawColors.blue700,  dark: rawColors.blue500 },
    'status.done.bg':      { light: rawColors.green50,  dark: '#14532d' },
    'status.done.text':    { light: rawColors.green700, dark: rawColors.green500 },
    'status.failed.bg':    { light: rawColors.red50,    dark: '#450a0a' },
    'status.failed.text':  { light: rawColors.red700,   dark: rawColors.red500 },
    'status.pending.bg':   { light: rawColors.gray100,  dark: rawColors.gray800 },
    'status.pending.text': { light: rawColors.gray600,  dark: rawColors.gray400 },
    'status.paused.bg':    { light: rawColors.amber50,  dark: '#451a03' },
    'status.paused.text':  { light: rawColors.amber700, dark: rawColors.amber500 },
  },
} as const;
```

### 3. spacing.ts

```typescript
// src/design-system/tokens/spacing.ts
export const spacing = {
  0:    '0px',
  0.5:  '2px',
  1:    '4px',
  1.5:  '6px',
  2:    '8px',
  3:    '12px',
  4:    '16px',
  5:    '20px',
  6:    '24px',
  8:    '32px',
  10:   '40px',
  12:   '48px',
  16:   '64px',
  20:   '80px',
  24:   '96px',
} as const;

export type SpacingKey = keyof typeof spacing;
```

### 4. typography.ts

```typescript
// src/design-system/tokens/typography.ts
export const typography = {
  fontSizes: {
    xs:   '12px',
    sm:   '14px',
    md:   '16px',
    lg:   '18px',
    xl:   '20px',
    '2xl': '24px',
    '3xl': '30px',
    '4xl': '36px',
  },
  fontWeights: {
    normal:   400,
    medium:   500,
    semibold: 600,
    bold:     700,
  },
  lineHeights: {
    tight:  1.25,
    snug:   1.375,
    normal: 1.5,
    relaxed: 1.625,
  },
  letterSpacings: {
    tight:  '-0.025em',
    normal: '0',
    wide:   '0.025em',
    wider:  '0.05em',
  },
} as const;
```

### 5. index.ts — 统一导出

```typescript
// src/design-system/tokens/index.ts
export * from './colors';
export * from './spacing';
export * from './typography';
export * from './shadows';
export * from './radii';
export * from './semantic';

// CSS 变量生成（仿 chakra-ui css-var.ts）
export function generateCssVars(mode: 'light' | 'dark'): Record<string, string> {
  const { semanticTokens } = require('./semantic');
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(semanticTokens.colors)) {
    const cssVar = `--ds-color-${key.replace(/\./g, '-')}`;
    vars[cssVar] = (value as any)[mode];
  }
  return vars;
}
```

---

## 接入方式（TailwindCSS 项目）

在 `tailwind.config.js` 中：

```js
const { rawColors, statusColors } = require('./src/design-system/tokens/colors');
const { spacing } = require('./src/design-system/tokens/spacing');
const { typography } = require('./src/design-system/tokens/typography');

module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: rawColors.brand50,
          500: rawColors.brand500,
          600: rawColors.brand600,
          // ...
        },
        status: statusColors,
      },
      spacing,
      fontSize: typography.fontSizes,
      fontWeight: typography.fontWeights,
    },
  },
};
```

## 接入方式（CSS Variables 项目）

在 `_app.tsx` 或根组件中：

```tsx
import { generateCssVars } from '@/design-system/tokens';

function App({ Component, pageProps }) {
  const vars = generateCssVars('light'); // 或从 context 读 dark/light
  return (
    <div style={vars}>
      <Component {...pageProps} />
    </div>
  );
}
```

---

## 验收标准

- [ ] `src/design-system/tokens/` 目录下6个文件全部创建
- [ ] 所有语义色在 light/dark 两种模式下都有对应值
- [ ] statusColors 涵盖：running/completed/failed/paused/pending/backgrounded/cancelled
- [ ] tailwind.config.js 或 CSS variable 注入机制接入
- [ ] 现有至少 3 个 operations 页面迁移到使用语义 token
- [ ] dark mode 切换后颜色正确变化（无硬编码颜色残留）

---

## 参考文件

- `f:/openclaw-agent/docs/OPENSAAS_ECOSYSTEM_BORROWING_ANALYSIS.md` 第三章
- chakra-ui: `packages/react/src/styled-system/semantic.ts`
- chakra-ui: `packages/react/src/styled-system/token-dictionary.ts`
