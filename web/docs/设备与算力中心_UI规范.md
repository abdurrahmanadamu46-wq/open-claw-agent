# 设备与算力中心 — UI 规范（商业化 Fleet + 远程探针）

**路由：** `/devices`  
**菜单：** 侧栏顶级【设备与算力中心】  
**技术：** React Query + Shadcn 风格组件（Card / Dialog / Progress）+ 深色主题

---

## 1. 设备池列表页

- **指标卡：** 在线/总数、今日算力利用率（Progress）、离线告警（标红）
- **表格列：** 备注+设备ID、状态灯（🟢运行中 / 🟡待机·冷却 / 🔴离线）、当前 Campaign（链到运营任务）、CPU/内存 Progress、操作（重启/解绑/查看实时画面）
- **Mock：** `src/services/device-fleet.mock.ts`，无 C&C 也可完整演示

## 2. 远程画面探针

- **入口：** 表格内「查看实时画面」→ **居中 Modal**（非跳转）
- **Monitor：** 黑底 + 红色 **LIVE** 呼吸灯 + `<img>` 高频换 `src`
- **MVP：** 1fps Base64 JPEG，经 WS `probe.render`；当前用 `useDeviceProbe` 1fps Canvas Mock
- **控制面：** 强制中止任务、清除浏览器缓存（演示 Toast，接 WS 后由小明下发）

## 3. Hook

- **`useDeviceProbe(deviceId, enabled)`**  
  - 仅 `enabled === true`（Modal 打开）时订阅/定时帧  
  - 关闭即 cleanup，节省带宽

## 4. 文件清单

| 路径 | 说明 |
|------|------|
| `src/app/devices/page.tsx` | 大盘 + 表格 + 探针 Modal |
| `src/services/device-fleet.mock.ts` | Mock 指标与设备列表 |
| `src/types/device-fleet.ts` | FleetDeviceRow / FleetMetrics |
| `src/hooks/useDeviceProbe.ts` | 探针帧源；待接 probe.render |
| `src/components/ui/Dialog.tsx` | Modal 壳 |
| `src/components/ui/Progress.tsx` | 性能条 |
