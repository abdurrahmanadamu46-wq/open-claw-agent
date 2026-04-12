# VIP 一号客户特供版 — 打包与交付

## 1. 准备

- 根目录已 `npm install`（需要 `socket.io-client`）。
- 小明已签发 **CLIENT_DEVICE_TOKEN**（JWT），且 **ClientDevice** 已白名单 **MACHINE_CODE**。

## 2. 本地验证

```powershell
cd 仓库根目录
copy scripts\vip-build\.env.vip.example scripts\vip-build\.env.vip
# 编辑 .env.vip 填入真实 URL / TOKEN / MACHINE_CODE

node scripts/vip-build/vip-lobster-entry.cjs
```

看到 **🟢 龙虾节点已连接云端** 即通过。

## 3. 打 Windows exe（pkg）

```powershell
npm install -D pkg
npx pkg scripts/vip-build/vip-lobster-entry.cjs --targets node18-win-x64 --output dist/vip-lobster.exe
```

- 把 **vip-lobster.exe** 与 **.env.vip** 放同一目录交给客户；或仅发 exe，token 写死进 cjs 再打包（**仅一号客户临时**）。
- 若 pkg 报缺模块，在仓库根目录执行打包，确保 `node_modules/socket.io-client` 存在。

## 4. Mac .dmg

Tauri 默认打包或 pkg `node18-macos-x64` 同理；客户机器需能访问总控 URL（防火墙/HTTPS）。

## 5. 总控侧

- 网关 **全天候** 监听；设备一连即 ONLINE。
- 第一条线索：可对 VIP 节点手动 dispatch 一次，或走 BullMQ；客户端已带验收用 `client.lead.report`。
