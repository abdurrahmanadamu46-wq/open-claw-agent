# China Channel Config v0.1

This repo does not yet have the full plugin-based `channels.<id>` runtime from
`openclaw-china`, but it can already benefit from the same configuration model.

What is configured in this round:

- `.env.example`
- `.env`
- `channels.china.example.json`

Current runtime-supported channels in `dragon-senate-saas-v2`:

- `telegram`
- `feishu`
- `dingtalk`

Config-ready placeholders prepared for later adapters:

- `qqbot`
- `wecom`
- `wecom-app`
- `wecom-kf`
- `wechat-mp`

Notes:

- `FEISHU_*` and `DINGTALK_*` are already consumed by the current backend.
- `QQBOT_*`, `WECOM_*`, `WECOM_APP_*`, `WECOM_KF_*`, and `WECHAT_MP_*` are
  config scaffolds only for now. They do not become active until the matching
  adapter code is added.
- `FEISHU_ACCOUNTS_JSON` and `DINGTALK_ACCOUNTS_JSON` were added so the current
  env model can evolve toward the multi-account pattern used by
  `openclaw-china`.
- `CHINA_CHANNEL_CONFIG_PATH=./channels.china.example.json` points to the
  OpenClaw-China-style sample config contract for future adapter work.

Recommended next implementation order:

1. `qqbot`
2. `wecom`
3. `wecom-app`
4. `wecom-kf`
5. `wechat-mp`

These are the channels whose configuration contract is now pre-laid in this
repo.
