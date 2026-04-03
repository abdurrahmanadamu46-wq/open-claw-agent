# Catcher Skill Gotchas

## catcher_lead_score
- 评分规则必须可解释，不能只给总分不给原因。
- 低样本行业要避免照搬通用评分模板。

## catcher_crm_push
- 写 CRM 前先做字段去重和格式校验。
- 失败写入不能静默，需要保留重试和告警。

## catcher_cross_platform_dedup
- 去重不要只靠昵称，至少结合渠道和联系方式。
- 模糊匹配阈值过高会误合并不同客户。
