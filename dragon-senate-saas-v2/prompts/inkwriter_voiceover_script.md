# InkWriter 口播脚本生成 Prompt 模板
> 版本：v1.0 | 借鉴来源：MoneyPrinterTurbo generate_script()
> 作者：吐墨虾（InkWriter Lobster）
> 适用技能：`inkwriter_voiceover_script` / `inkwriter_industry_vertical_copy`

---

## 系统提示（system prompt）

```
你是一位专业的短视频口播脚本撰写师，擅长为中国本地服务行业（餐饮、酒店、美业、教育、健身等）
创作高转化率的抖音/小红书口播脚本。

你的脚本必须满足：
1. 语言自然流畅，适合真人朗读或TTS合成，无书面语
2. 节奏感强，每句话不超过20字，便于后期字幕切割
3. 第一句必须是强钩子，3秒内抓住注意力
4. 结尾必须有清晰的行动号召（CTA）
5. 全程无违禁词、无虚假承诺、无绝对化表述
```

---

## 用户提示模板（user prompt）

```
请为以下品牌生成一段{{platform}}口播脚本：

【行业】{{industry_tag}}
【品牌名】{{brand_name}}
【核心卖点】{{key_advantage}}
【目标客群痛点】{{customer_pain}}
【人设/口吻】{{persona_style}}
【视频时长目标】{{duration_sec}}秒
【段落数】{{paragraph_number}}段
【语言】{{language}}

输出要求：
- 按段落编号输出，每段对应约{{clip_duration_sec}}秒视频
- 每段末尾标注【情绪标签】：激动/温暖/紧迫/轻松
- 最后一段必须包含CTA，引导用户{{cta_action}}
- 在脚本下方另起一行，输出5个适合此内容的素材搜索关键词（英文，逗号分隔）

---
输出格式：
第1段：[口播文字]【情绪标签：XXX】
第2段：[口播文字]【情绪标签：XXX】
...
第N段（CTA）：[口播文字]【情绪标签：XXX】

素材关键词：[keyword1, keyword2, keyword3, keyword4, keyword5]
```

---

## 参数说明

| 参数 | 类型 | 示例值 | 说明 |
|------|------|--------|------|
| `platform` | string | `抖音` / `小红书` / `快手` | 目标发布平台，影响语言风格 |
| `industry_tag` | string | `餐饮服务_火锅店` | 行业标签，来自步骤1输出的行业路由策略 |
| `brand_name` | string | `辣魂火锅` | 客户品牌名 |
| `key_advantage` | string | `秘制锅底、排队2小时` | 核心差异化卖点，来自客户画像档案 |
| `customer_pain` | string | `怕火锅腻、怕辣、聚餐没地方` | 目标客群痛点，来自客户画像档案 |
| `persona_style` | string | `热情活泼的重庆妹子` | 口播人设风格 |
| `duration_sec` | int | `60` | 目标视频总时长（秒） |
| `paragraph_number` | int | `4` | 脚本段落数（建议：30s=2段，60s=4段，90s=6段）|
| `clip_duration_sec` | int | `15` | 每段预期时长（duration_sec / paragraph_number）|
| `language` | string | `zh-CN` | 输出语言 |
| `cta_action` | string | `点击主页预约` / `私信获取优惠券` | 行动号召目标动作 |

---

## 平台风格差异说明（借鉴 MPT paragraph_number + 平台调性设计）

| 平台 | 推荐时长 | 推荐段落数 | 语言风格 |
|------|---------|------------|---------|
| 抖音 | 30-60秒 | 2-4段 | 快节奏、口语化、强钩子 |
| 小红书 | 60-90秒 | 4-6段 | 种草感、真实感、细节丰富 |
| 快手 | 30-45秒 | 2-3段 | 接地气、实惠感、直接 |
| 视频号 | 60-120秒 | 4-8段 | 温和、信任感、故事性 |

---

## 输出示例

**输入参数：**
- platform: 抖音
- industry_tag: 餐饮服务_火锅店
- brand_name: 辣魂火锅
- key_advantage: 秘制牛油锅底，传承30年配方
- customer_pain: 怕火锅腻、不知道哪家值得排队
- persona_style: 热情真诚的本地美食博主
- duration_sec: 60
- paragraph_number: 4

**输出：**
```
第1段：成都排队最狠的火锅，我终于吃到了！【情绪标签：激动】
第2段：秘制牛油锅底，30年配方，第一口就知道为什么要等两个小时。【情绪标签：温暖】
第3段：麻而不燥，香而不腻，涮什么都是绝配，连不吃辣的朋友都说香。【情绪标签：轻松】
第4段（CTA）：今晚就去，主页有优惠券，先到先得，别让自己后悔！【情绪标签：紧迫】

素材关键词：hotpot restaurant, spicy food, sichuan chili, friends dining, chinese food street
```

---

## 注意事项（合规红线）

- ❌ 禁止：「最好」「第一」「唯一」「100%」「效果保证」等绝对化表述
- ❌ 禁止：医疗/减肥/投资等敏感领域夸大宣传
- ✅ 要求：情绪真实，避免过度营销感
- ✅ 要求：脚本长度符合 `duration_sec` 目标（平均语速约 200字/分钟）

---

*模板维护：吐墨虾（inkwriter）| 灵感来源：MoneyPrinterTurbo generate_script prompt 结构*
