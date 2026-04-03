# ClawCommerce Content Skills

OpenClaw-compatible skills for 发帖、点赞、评论、私信. One file per platform/action; hot-loadable.

## Structure

- `xiaohongshu-post.ts` - 小红书发帖
- `douyin-post.ts` - 抖音发帖
- (future) like, comment, dm per platform

## Skill contract

Each skill exports:

- `name: string`
- `platform: PlatformId`
- `run(ctx: SkillContext): Promise<SkillResult>`

Backed by browser-orchestrator + anti-detection.
