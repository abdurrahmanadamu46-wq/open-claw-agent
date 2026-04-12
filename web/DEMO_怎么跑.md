# Demo 怎么跑（已加固，不依赖 env 也能进）

## ⚠️ 重要：端口以终端为准

运行 `npm run dev` 后，**必须看终端里显示的端口**。例如：

```
⚠ Port 3000 is in use, trying 3001 instead.
...
- Local:        http://localhost:3005
```

此时 **不要** 打开 `http://localhost:3000/demo.html`（会“无法获取”）  
→ 应打开 **http://localhost:3005/demo.html**（与终端里 Local 的端口一致）。

## 推荐：一键进入（不必登录、不必填表）

1. 启动：
   ```bash
   cd web
   npm run dev
   ```
2. 浏览器打开（**端口用终端里 Local 显示的，下例为 3005**）：
   - **http://localhost:3005/demo.html**（静态页）
   - **http://localhost:3005/demo**（Next 路由）
3. 会自动写入演示 token 并跳转到数据大盘。

## 备选：登录页一键演示

打开 **http://localhost:端口/login**（端口同上），点 **「一键进入演示（无需账号）」**，效果同上。

## 逻辑说明（为何之前打不开）

- 仅依赖 `NEXT_PUBLIC_USE_MOCK=true` 时，若未重启 dev 或 env 未打进 bundle，接口仍会请求后端 → 404/失败。
- 现已统一用 `isDemoMode()`：
  - `NEXT_PUBLIC_USE_MOCK=true` **或**
  - `NEXT_PUBLIC_API_BASE_URL` 为空 **或**
  - 本地已执行过 `/demo` 或一键演示（`localStorage.clawcommerce_demo_mode === '1'`）
- 满足任一条件即走 Mock，大盘/任务/线索/龙虾状态不再强依赖后端。

## 端口被占用时

若 3000 已被其它程序占用，Next 会改用 3001、3002… 请看终端里 **Local: http://localhost:xxxx**。

要**固定占用 3000**：

```bash
# 先结束占用 3000 的进程，再在 web 目录执行：
npm run dev:3000
```

## 可选 `.env.local`

```env
NEXT_PUBLIC_USE_MOCK=true
NEXT_PUBLIC_API_BASE_URL=
```

改 env 后需重启 `npm run dev`。

## 侧栏

侧栏第一个入口为 **「演示入口」**，随时可再进 `/demo` 刷新演示态。
