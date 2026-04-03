# ClawX 级桌面化收口说明

## 本次已落地

1. GUI 初始化向导（Step 1~5）  
路径：`apps/desktop-client/src/App.tsx`

2. 内置运行时打包  
- 运行时目录：`apps/desktop-client/runtime`  
- 打包配置：`apps/desktop-client/src-tauri/tauri.conf.json` (`bundle.resources`)
- 同步脚本：`apps/desktop-client/scripts/sync-runtime.ps1`

3. 一键升级链路（桌面内按钮）  
- Rust 命令：`desktop_runtime_status/init/update`  
- 实现：`apps/desktop-client/src-tauri/src/lib.rs`

## 构建命令

```bash
# 在 desktop-client 目录
npm install
npm run runtime:sync
npm run tauri:build
```

或从仓库根目录：

```bash
npm run apps:build:desktop
```

## 运行时行为

- `desktop_runtime_init`：将内置 runtime 解压到本机 app data 目录并写入首启 marker。
- `desktop_runtime_update`：检查 bundled version vs installed version，支持一键覆盖升级。
- `desktop_runtime_status`：返回版本、路径、是否已初始化、是否有可升级版本。

## 说明

- 当前升级链路采用“随安装包分发的内置 runtime + 本地版本比较”。
- 如需接入远程发布源（签名 manifest + SHA256 + keyId 轮换）可直接复用已有 `dragon update` 验签逻辑扩展。
