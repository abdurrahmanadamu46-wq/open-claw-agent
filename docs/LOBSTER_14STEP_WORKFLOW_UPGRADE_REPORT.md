# 龙虾池 14步工作流完善报告
> 生成时间：2026-04-01
> 依据：用户提供的"3自动执行链路14步"流程图
> 状态：✅ 已落地

---

## 一、图中14步链路解析

| 步骤 | 名称 | 模式 | 参与龙虾 | 输出工件 |
|------|------|------|----------|----------|
| 1 | 确认行业标签 | 自动 | 脑虫虾 + 触须虾 | 行业路由策略 |
| 2 | 录入客户信息 | 自动 | 脑虫虾 + 记忆处理 | 客户画像档案 |
| 3 | 选题生成与评分 | 自动 | 脑虫虾 + 吐墨虾 + 金算虾 | 高分选题清单 |
| 4 | 合规审核 | **审批** | 铁网虾 + Guardian | 合规审核报告 |
| 5 | 文案与声音生成 | 自动 | 吐墨虾 + 回访虾 | 文案与语音资产 |
| 6 | 画面匹配与分镜 | 自动 | 幻影虾 | 分镜素材包 |
| 7 | 字幕特效与配乐 | 自动 | 幻影虾 + 点兵虾 | 成片草案 |
| 8 | 标题封面生成 | 自动 | 吐墨虾 + 幻影虾 | 标题封面组合 |
| 9 | 云端归档 | 自动 | 点兵虾 + 金算虾 | 归档任务包 |
| 10 | 下发边缘任务 | 自动 | 点兵虾 | 边缘执行计划 |
| 11 | 监视评论私信 | 自动（异步持续72h） | 回声虾 + 铁网虾 | 线索事件流 |
| 12 | 线索评分 | 自动 | 金算虾 + 铁网虾 | 线索评分结果 |
| 13 | 高分线索跟进 | **审批** | 回访虾 | 电话跟进记录 |
| 14 | 飞书反馈与录音回传 | 自动 | 回访虾 + 金算虾 | 飞书线索通知+录音 |

---

## 二、本次新增的技能清单（对比原registry）

### 触须虾（radar）新增
| skill_id | 功能描述 | 步骤 |
|----------|----------|------|
| `radar_industry_tag_confirm` | 按行业标签加载知识池并锁定策略模板 | 1 |

### 脑虫虾（strategist）新增
| skill_id | 功能描述 | 步骤 |
|----------|----------|------|
| `strategist_industry_tag_lock` | 确认行业标签，锁定策略模板 | 1 |
| `strategist_customer_profile_ingest` | 沉淀客户痛点优势人设进入记忆层 | 2 |
| `strategist_topic_generate` | 生成候选选题并完成转化评分 | 3 |

### 吐墨虾（inkwriter）新增
| skill_id | 功能描述 | 步骤 |
|----------|----------|------|
| `inkwriter_industry_vertical_copy` | 生成行业垂直文案 | 5 |
| `inkwriter_voiceover_script` | 生成口播脚本 | 5 |
| `inkwriter_title_ab_generate` | 多版本标题AB组合 | 8 |

### 幻影虾（visualizer）新增
| skill_id | 功能描述 | 步骤 |
|----------|----------|------|
| `visualizer_semantic_material_match` | 按文案语义匹配分镜素材 | 6 |
| `visualizer_subtitle_fx_bgm` | 字幕特效+背景音乐合成成片 | 7 |
| `visualizer_cover_ab_generate` | 多版本封面AB组合 | 8 |

### 点兵虾（dispatcher）新增
| skill_id | 功能描述 | 步骤 |
|----------|----------|------|
| `dispatcher_bgm_pack` | 为成片配乐并打包 | 7 |
| `dispatcher_cloud_archive` | 内容素材统一归档 | 9 |
| `dispatcher_edge_health_check` | 检查边缘设备健康 | 10 |
| `dispatcher_edge_task_push` | 将任务推送到边缘节点 | 10 |

### 回声虾（echoer）新增
| skill_id | 功能描述 | 步骤 |
|----------|----------|------|
| `echoer_realtime_comment_stream` | 回传评论私信实时线索流 | 11 |
| `echoer_dm_lead_capture` | 自动回复私信识别意向客户 | 11 |

### 铁网虾（catcher）新增
| skill_id | 功能描述 | 步骤 |
|----------|----------|------|
| `catcher_compliance_audit` | 违规词/敏感词审核（需人工确认） | 4 |
| `catcher_sensitive_word_filter` | 实时过滤评论违禁词 | 11 |
| `catcher_complaint_risk_flag` | 投诉风险综合打分 | 12 |

### 金算虾（abacus）新增
| skill_id | 功能描述 | 步骤 |
|----------|----------|------|
| `abacus_topic_score` | 选题转化评分 | 3 |
| `abacus_archive_report` | 归档审计报告 | 9 |
| `abacus_lead_score_model` | 线索综合评分模型 | 12 |
| `abacus_call_log_ingest` | 通话录音入库 | 14 |

### 回访虾（followup）新增
| skill_id | 功能描述 | 步骤 |
|----------|----------|------|
| `followup_voiceover_collab` | 协同吐墨虾生成口播声音 | 5 |
| `followup_phone_trigger` | 人工审批后触发电话跟进 | 13 |
| `followup_feishu_notify` | 飞书线索摘要通知 | 14 |
| `followup_call_summary_push` | 通话录音回传飞书/CRM | 14 |

---

## 三、新建工件

| 文件 | 说明 |
|------|------|
| `dragon-senate-saas-v2/workflows/content-campaign-14step.yaml` | 完整14步工作流定义 |
| `dragon-senate-saas-v2/lobsters-registry.json` | 全量龙虾技能注册表（含所有新增skill） |

---

## 四、工作流架构图

```
触发器（industry_tag + customer_brief）
  │
  ▼
[步骤1] 确认行业标签（触须虾+脑虫虾）→ 行业路由策略
  │
  ▼
[步骤2] 录入客户信息（脑虫虾）→ 客户画像档案 → 写入L0记忆
  │
  ▼
[步骤3] 选题生成与评分（脑虫虾+吐墨虾+金算虾）→ 高分选题清单
  │
  ▼
[步骤4] 合规审核 🔴审批 （铁网虾）→ 合规审核报告 + 通过选题
  │
  ├──────────────────────────────────────┐
  ▼                                      ▼
[步骤5] 文案与声音生成               [步骤8] 标题封面（吐墨虾+幻影虾）
（吐墨虾+回访虾）                          │
  │                                      │
  ▼                                      │
[步骤6] 画面分镜（幻影虾）            │
  │                                      │
  ▼                                      │
[步骤7] 字幕配乐（幻影虾+点兵虾）    │
  │                                      │
  └──────────────────────────────────────┘
                    │
                    ▼
         [步骤9] 云端归档（点兵虾+金算虾）→ 归档任务包
                    │
                    ▼
         [步骤10] 下发边缘任务（点兵虾）→ 边缘执行计划
                    │
                    ▼
         [步骤11] 监视评论私信 ⚡异步72h（回声虾+铁网虾）→ 线索事件流
                    │
                    ▼
         [步骤12] 线索评分（金算虾+铁网虾）→ 线索评分结果
                    │
            高分线索？
              │ Yes
              ▼
         [步骤13] 高分线索跟进 🔴审批（回访虾）→ 电话跟进记录
                    │
                    ▼
         [步骤14] 飞书反馈与录音回传（回访虾+金算虾）→ 飞书通知+CRM归档
                    │
                    ▼
              闭环完成 ✅（写回记忆 → 优化下次选题）
```

---

## 五、两个审批节点说明

| 审批节点 | 步骤 | 超时策略 | 说明 |
|----------|------|----------|------|
| 合规审核 | 步骤4 | 24h后升级给Commander | 违禁词/平台规则卡口，不可绕过 |
| 高分跟进 | 步骤13 | 4h后低风险自动放行 | 控制高意向客户电话触达时机 |

---

## 六、待落地的配套任务（建议下一步）

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | `abacus.py` 补充 `abacus_topic_score` 和 `abacus_lead_score_model` 方法 | 当前只有基础归因功能 |
| P0 | `followup.py` 补充 `followup_feishu_notify` + `followup_phone_trigger` | 飞书Webhook集成 |
| P0 | `catcher.py` 补充 `catcher_compliance_audit` 合规审核逻辑 | Guardian集成点 |
| P1 | `visualizer.py` 补充 `visualizer_subtitle_fx_bgm` | 对接字幕/BGM工具 |
| P1 | `dispatcher.py` 补充 `dispatcher_edge_health_check` | 边缘设备状态查询 |
| P2 | 工作流引擎支持 `async: true` 步骤（步骤11监控模式） | 当前引擎是同步流 |
| P2 | 前端 `/operations/workflows` 中添加14步工作流模板卡片 | 可直接触发 |

---

*生成时间：2026-04-01 | 维护者：龙虾池团队*
