# OpenClaw 相关 GitHub 资料收集与优点分析记录

> 收集时间：2026年3月  
> 用途：汇总 GitHub 上与 OpenClaw 相关的资料，并分析各项目/资源的优点

---

## 一、官方与核心仓库

### 1. openclaw/openclaw（主仓库）

| 项目 | 说明 |
|------|------|
| **地址** | https://github.com/openclaw/openclaw |
| **简介** | 个人 AI 助手，运行在自有设备上，支持多平台、多通道。 |
| **规模** | 约 28 万+ Stars，54k+ Forks，360+ 贡献者，11k+ open issues |
| **技术栈** | TypeScript（约 87%）、Swift、Kotlin 等 |
| **许可证** | MIT |

**核心定位（来自 README / VISION）：**

- “The AI that actually does things.” —— 能真正执行任务的 AI。
- 在用户设备、用户渠道、用户规则下运行，本地优先。
- 演进历程：Warelay → Clawdbot → Moltbot → OpenClaw。

**优点归纳：**

1. **本地优先、隐私可控**  
   数据与对话在本地设备处理，不依赖第三方云存储，符合隐私优先设计。

2. **多通道统一入口**  
   支持 20+ 通讯平台：WhatsApp、Telegram、Slack、Discord、Google Chat、Signal、iMessage（含 BlueBubbles）、IRC、Microsoft Teams、Matrix、Feishu、LINE、Mattermost、Nextcloud Talk、Nostr、Synology Chat、Tlon、Twitch、Zalo、WebChat 等，一个助手覆盖多场景。

3. **主动执行能力（Agent）**  
   不仅是聊天机器人，可执行命令、浏览网页、管理日历、处理邮件、定时任务、状态监控与告警等，真正“替用户做事”。

4. **多模型、多提供商**  
   不绑定单一厂商，支持 OpenAI、Anthropic、Google、本地 Ollama/LM Studio 等，可配置模型切换与故障转移。

5. **插件与技能生态**  
   - 插件 API 丰富，能力通过插件扩展，核心保持精简。  
   - 技能通过 ClawHub 发布与安装，社区技能市场（100+ 技能）。  
   - 支持 MCP（Model Context Protocol），通过 mcporter 集成。

6. **终端优先、可复现部署**  
   推荐 `openclaw onboard` 向导 + CLI，配置透明；支持 Nix、Docker，便于复现与运维。

7. **安全与默认策略**  
   有明确安全策略（SECURITY.md），DM 默认配对策略、允许名单等，降低误用与滥用风险。

8. **跨平台与伴生应用**  
   支持 macOS、Linux、Windows（WSL2）、树莓派；提供 macOS 菜单栏应用、iOS/Android 节点、Voice Wake、Talk Mode、Live Canvas 等。

9. **社区与迭代**  
   Star 与 Fork 数量高，贡献者多，文档（含 VISION.md）与路线图清晰，迭代快。

10. **TypeScript 为主**  
    便于阅读、修改和二次开发，适合作为“可 hack”的编排层（提示、工具、协议、集成）。

---

### 2. openclaw/clawhub

| 项目 | 说明 |
|------|------|
| **地址** | https://github.com/openclaw/clawhub |
| **官网** | https://clawhub.ai |
| **定位** | OpenClaw 官方技能注册表与市场 |

**优点：**

- 技能发现与安装：`clawhub search`、`clawhub install`、`clawhub publish`。
- 向量搜索（如 OpenAI embeddings）而非仅关键词，更易找到相关技能。
- 版本与 changelog、社区星级与评论、审核机制，便于质量把控。
- 技术栈：TanStack Start (React) + Convex + GitHub OAuth，前后端分离、可扩展。

---

### 3. openclaw/docs

| 项目 | 说明 |
|------|------|
| **地址** | 文档站点 https://docs.openclaw.ai（源码应在 openclaw 组织下） |
| **定位** | 官方文档源码 |

**优点：**

- 安装、配置、通道、安全、网关、技能、MCP 等全覆盖。
- 与主仓库版本协同，便于贡献文档与保持一致性。

---

### 4. openclaw/nix-openclaw

| 项目 | 说明 |
|------|------|
| **引用** | README 中 Nix 链接指向 https://github.com/openclaw/nix-openclaw |
| **定位** | Nix 声明式安装与配置 |

**优点：**

- 可复现环境、与 Nix 生态集成，适合高级用户与自动化部署。

---

## 二、相关生态与第三方仓库

### 5. steipete/mcporter

| 项目 | 说明 |
|------|------|
| **地址** | https://github.com/steipete/mcporter |
| **定位** | MCP（Model Context Protocol）与 OpenClaw 的桥接 |

**优点（VISION 中明确偏好）：**

- 不把 MCP 运行时塞进核心，保持核心精简、稳定、安全。
- 可增删 MCP 服务器而无需重启 Gateway，灵活可扩展。
- MCP 协议变动对核心影响小。

---

### 6. Awesome 列表（社区整理）

| 仓库/站点 | 说明与优点 |
|-----------|------------|
| **thewh1teagle/awesome-openclaw** | 生态精选：ClawHub、ClawRouter、MoltBook、基础设施工具等，便于快速了解生态。 |
| **rylena/awesome-openclaw** | 整合安装指南、生态资源与技能目录，一站式查阅。 |
| **rohitg00/awesome-openclaw** | 侧重安装方式、托管商、成本对比、安全加固与真实用例，偏实践与选型。 |

---

## 三、优点汇总表（按维度）

| 维度 | 优点简述 |
|------|----------|
| **隐私与数据** | 本地/自托管优先，数据自主可控，无强制上云。 |
| **渠道与入口** | 20+ 通讯平台统一入口，跨渠道会话与回复。 |
| **能力形态** | 主动 Agent：执行命令、浏览、日历、邮件、定时、监控、告警。 |
| **模型与供应商** | 多模型、多提供商、故障转移，不绑定单一厂商。 |
| **扩展性** | 插件 API、ClawHub 技能市场、MCP 桥接（mcporter）。 |
| **安全与策略** | 安全默认、DM 策略、SECURITY.md、审核与权限设计。 |
| **开发与运维** | TypeScript、CLI/向导、Nix/Docker、Doctor、日志与排错文档。 |
| **平台与形态** | 多 OS、伴生 App（macOS/iOS/Android）、Voice Wake、Canvas。 |
| **社区与治理** | 高 Star/Fork、多贡献者、VISION 与 CONTRIBUTING 明确、迭代快。 |
| **技能与内容** | 技能版本化、向量搜索、社区评分与审核（ClawHub）。 |

---

## 四、官方重要文档与链接

| 资源 | 链接 |
|------|------|
| 官网 | https://openclaw.ai |
| 文档 | https://docs.openclaw.ai |
| 入门 | https://docs.openclaw.ai/start/getting-started |
| 向导 | https://docs.openclaw.ai/start/wizard |
| 更新 | https://docs.openclaw.ai/install/updating |
| 安全 | https://docs.openclaw.ai/gateway/security |
| 愿景（仓库内） | [VISION.md](https://github.com/openclaw/openclaw/blob/main/VISION.md) |
| 贡献指南 | [CONTRIBUTING.md](https://github.com/openclaw/openclaw/blob/main/CONTRIBUTING.md) |
| 安全政策 | [SECURITY.md](https://github.com/openclaw/openclaw/blob/main/SECURITY.md) |
| DeepWiki | https://deepwiki.com/openclaw/openclaw |
| Discord | https://discord.gg/clawd |
| ClawHub | https://clawhub.ai |

---

## 五、当前优先级（来自 VISION.md）

**当前优先：**

- Security and safe defaults  
- Bug fixes and stability  
- Setup reliability and first-run UX  

**下一步优先：**

- Supporting all major model providers  
- Improving support for major messaging channels（及若干高需求新通道）  
- Performance and test infrastructure  
- Better computer-use and agent harness capabilities  
- CLI 与 Web 前端的人体工学  
- 各平台伴侣应用（macOS、iOS、Android、Windows、Linux）  

---

## 六、简要结论

- **核心资料**：以 **openclaw/openclaw** 为主仓库，**openclaw/clawhub**、**openclaw/docs**、**openclaw/nix-openclaw** 及 **steipete/mcporter** 为重要补充。  
- **优点**：本地优先与隐私、多通道与多模型、主动 Agent 能力、插件与技能生态、安全默认与可运维性、跨平台与社区活跃度。  
- **记录用途**：可作为选型依据、贡献入口、或二次开发（如 openclaw-agent）时的背景参考。  

如需对某一仓库或某类优点做更细的整理（例如仅列 GitHub 链接清单或仅写“优点”一栏），可说明具体格式或用途，便于再补一版。
