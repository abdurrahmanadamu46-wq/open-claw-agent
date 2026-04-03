# Dragon Edge Skill Pack (pkgx-native)

This manifest is designed for `edge_agent.py` auto-discovery and zero-install execution.
All examples run via pkgx cache and do not pollute the host system.

## Runtime Notes

- Cache directory: `~/.pkgx` (override with `PKGX_DIR` / `PKGX_CACHE_DIR`)
- Host remains clean: commands are resolved in pkgx runtime, not global PATH
- Reproducible versions: pin package versions in shebang or command line

## Skills

### skill: monitor-dm
- Description: Monitor inbox DM streams and emit JSON events.
- Shebang example:
  - `#!/usr/bin/env -S pkgx +python@3.12 python`
- pkgx command:
  - `# pkgx: pkgx +python@3.12 python scripts/skills/monitor_dm.py --json`

### skill: publish-content
- Description: Publish structured content packages to target social accounts.
- Shebang example:
  - `#!/usr/bin/env -S pkgx +python@3.12 python`
- pkgx command:
  - `# pkgx: pkgx +python@3.12 python scripts/skills/publish_content.py --payload input.json`

### skill: video-publish
- Description: Execute short-video publishing pipeline.
- Shebang example:
  - `#!/usr/bin/env -S pkgx +python@3.12 +ffmpeg ffmpeg -version`
- pkgx command:
  - `# pkgx: pkgx +python@3.12 +ffmpeg python scripts/skills/video_publish.py --payload input.json`

### skill: intent-ner
- Description: Extract high-intent lead signals from comments and DMs.
- Shebang example:
  - `#!/usr/bin/env -S pkgx +python@3.12 python`
- pkgx command:
  - `# pkgx: pkgx +python@3.12 python scripts/skills/intent_ner.py --stdin-json`

### skill: agent-browser
- Description: Run browser automation capability under isolated pkgx runtime.
- Shebang example:
  - `#!/usr/bin/env -S pkgx +node@20 +playwright node -e "console.log('ok')"`
- pkgx command:
  - `# pkgx: pkgx +node@20 +playwright node scripts/skills/agent_browser.mjs`

## CLI-Anything Bridge

- `# pkgx: pkgx +python@3.12 python cli_anything.py discover --target douyin --output .edge_skills.json`
- `# pkgx: pkgx +python@3.12 python cli_anything.py discover --target wechat --output .edge_skills.json`
- `# pkgx: pkgx +python@3.12 python cli_anything.py build-skill-md --input .edge_skills.json --output SKILL.md`

