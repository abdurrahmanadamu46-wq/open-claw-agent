# Dragon Desktop Client（ClawX 级）

桌面端已提供：

1. GUI 初始化向导（Step 1~5）
2. 内置 runtime 打包（`bundle.resources -> runtime/**`）
3. 生产级升级链路（远端签名 manifest + SHA256 + keyId 轮换）

## 开发与打包

```bash
# 同步 runtime（从 dragon-senate-saas-v2 拷贝）
npm run runtime:sync

# 启动 Tauri 开发模式（包含 runtime:sync）
npm run tauri:dev

# 打包安装包（包含 runtime:sync）
npm run tauri:build
```

## 升级链路（生产级）

桌面端命令：

- `desktop_runtime_manifest_check`：校验 manifest 签名与 keyId
- `desktop_runtime_update`：校验 manifest + SHA256 后应用 runtime

### 建议环境变量

```bash
DESKTOP_UPDATE_MANIFEST_URL=https://release.example.com/dragon/runtime/stable.json
DESKTOP_UPDATE_REQUIRE_SIGNATURE=true
DESKTOP_UPDATE_DEFAULT_KEY_ID=prod-2026q1
DESKTOP_UPDATE_KEYS_JSON={"prod-2026q1":"hmac:xxxxx","prod-2026q2":"hmac:yyyyy"}
```

### 生成签名 manifest（发布侧）

```bash
# 方式1：默认输出到 runtime/updates/stable.json
npm run runtime:manifest:sign

# 方式2：显式参数（推荐）
python scripts/sign-runtime-manifest.py \
  --out runtime/updates/stable.json \
  --channel stable \
  --version 3.2.1 \
  --artifact-url https://release.example.com/dragon/runtime/dragon-runtime-3.2.1.zip \
  --artifact-file ..\\..\\dragon-senate-saas-v2\\dist\\dragon-runtime-3.2.1.zip \
  --key-id prod-2026q1 \
  --hmac-secret <YOUR_SECRET> \
  --notes "worker sync + policy bandit + update hardening"
```

> `keyId` 用于公钥/密钥轮换：新版本切到新 `keyId`，旧版本仍可由旧 key 验证，不影响存量客户端升级。
