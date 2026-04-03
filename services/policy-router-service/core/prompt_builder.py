"""
核心上下文组装器 (Context Router)
将策略张量 T(激进度, 拟真度, 转化导向) 翻译为各 Agent 的自然语言约束。
"""
from models.schemas import PolicyTensor

# 显示名 -> 标准 id（与 custom-lobster-agents 一致）
AGENT_ID_ALIASES = {
    "radar": "radar",
    "strategist": "strategist",
    "inkwriter": "ink-writer",
    "ink-writer": "ink-writer",
    "visualizer": "visualizer",
    "dispatcher": "dispatcher",
    "echoer": "echoer",
    "catcher": "catcher",
    "abacus": "abacus",
    "follow-up": "follow-up",
    "followup": "follow-up",
}


def _normalize_agent_id(agent_id: str) -> str:
    raw = (agent_id or "").strip().lower().replace("_", "-")
    return AGENT_ID_ALIASES.get(raw, raw)


class ContextRouter:
    """将张量水位翻译为各龙虾 Agent 的专属 Prompt 约束"""

    def build_prompt_for_agent(self, agent_id: str, task: str, tensor: PolicyTensor) -> str:
        """根据当前全局张量为指定 Agent 生成专属 Prompt。"""
        aid = _normalize_agent_id(agent_id)
        system_directive = (
            f"[SYSTEM] You are {agent_id}, a specialized node in the Lobster AI Network.\n"
        )
        policy_context = self._translate_tensor_to_rules(aid, tensor)
        final_prompt = f"""{system_directive}
[CURRENT OPERATIONAL POLICY]
{policy_context}

[TASK DIRECTIVE]
Execute the following task strictly adhering to the operational policy above:
{task}
"""
        return final_prompt

    def _translate_tensor_to_rules(self, agent_id: str, tensor: PolicyTensor) -> str:
        rules: list[str] = []

        # ---------- 吐墨虾 (ink-writer) ----------
        if agent_id == "ink-writer":
            if tensor.conversion_focus > 0.7 and tensor.aggressiveness > 0.6:
                rules.append(
                    "- 结构指令: 当前处于极速冲量期，请强制采用「10秒爆款短视频 (5个分镜)」的快节奏模板，前3秒必须抛出强利益钩子。"
                )
            elif tensor.authenticity > 0.7:
                rules.append(
                    "- 结构指令: 当前处于深度种草与养号期，请严格采用「30秒深度种草 (15个分镜)」模板，增加测评细节、犹豫感和第三方客观视角，字数需扩充。"
                )
            else:
                rules.append(
                    "- 结构指令: 采用平稳的「15秒故事带货 (7个分镜)」模板进行常规输出。"
                )
            if tensor.aggressiveness > 0.7:
                rules.append("- 话术指令: 钩子要直接、利益点前置，减少铺垫。")
            if tensor.authenticity > 0.75:
                rules.append("- 拟真指令: 适当加入口语化、轻微犹豫与真实感细节，避免过于工整的营销腔。")

        # ---------- 回声虾 (echoer) ----------
        elif agent_id == "echoer":
            if tensor.authenticity > 0.8:
                rules.append(
                    "- 话术指令: 必须注入极高的『行为熵』。允许使用口语化错别字、不带标点符号、大量使用 emoji。绝对不要像客服一样礼貌回复。"
                )
            if tensor.aggressiveness > 0.8:
                rules.append(
                    "- 转化指令: 在评论回复中，必须在 5 个字以内直接引流到主页或抛出暗号，无需过多寒暄。"
                )
            elif tensor.aggressiveness < 0.3:
                rules.append("- 转化指令: 以闲聊、养号为主，不主动引流，仅做情绪共鸣与话题延续。")
            if tensor.conversion_focus > 0.6:
                rules.append("- 节奏指令: 回复要短平快，可带购买/私信引导；反之偏长句、多轮互动。")

        # ---------- 触须虾 (radar) ----------
        elif agent_id == "radar":
            if tensor.aggressiveness > 0.6:
                rules.append("- 抓取指令: 提高抓取频率与覆盖面，优先爆款、高赞、近期热点。")
            if tensor.authenticity > 0.7:
                rules.append("- 数据指令: 保留更多原始噪音与边缘数据，便于拟真分析。")
            if tensor.conversion_focus > 0.6:
                rules.append("- 优先级: 转化相关指标（点击、转化路径）权重大于纯曝光。")

        # ---------- 脑虫虾 (strategist) ----------
        elif agent_id == "strategist":
            if tensor.conversion_focus > 0.7:
                rules.append("- 策略指令: 选题与人群参数优先「高转化赛道」与「强意向人群」。")
            if tensor.aggressiveness > 0.6:
                rules.append("- 节奏指令: 策略输出偏短周期、可快速执行的动作组合。")
            if tensor.authenticity > 0.7:
                rules.append("- 拟真指令: 人群与选题增加「真实用户行为分布」与 A/B 偏好，避免过于理想化。")

        # ---------- 幻影虾 (visualizer) ----------
        elif agent_id == "visualizer":
            if tensor.conversion_focus > 0.7 and tensor.aggressiveness > 0.6:
                rules.append("- 视觉指令: 分镜以强冲击力、前 3 秒吸睛为主；色彩与节奏偏快。")
            elif tensor.authenticity > 0.7:
                rules.append("- 视觉指令: 画面偏生活化、有瑕疵感与真实光影，避免过度精修。")
            else:
                rules.append("- 视觉指令: 采用常规分镜节奏与画面风格，平衡吸睛与可信。")

        # ---------- 点兵虾 (dispatcher) ----------
        elif agent_id == "dispatcher":
            if tensor.aggressiveness > 0.7:
                rules.append("- 调度指令: 允许更高并发与更短重试间隔，优先冲量。")
            if tensor.authenticity > 0.7:
                rules.append("- 调度指令: 任务间隔加入随机延迟与错峰，模拟人类操作节奏。")
            if tensor.conversion_focus > 0.6:
                rules.append("- 优先级: 转化相关任务（发帖、引流）优先于纯养号任务。")

        # ---------- 铁网虾 (catcher) ----------
        elif agent_id == "catcher":
            if tensor.authenticity > 0.8:
                rules.append("- 过滤指令: 提高意向阈值，仅放行高意向线索；对疑似硬广/敏感词更严格。")
            if tensor.aggressiveness > 0.7:
                rules.append("- 过滤指令: 可适当放宽意向门槛，多放行潜在线索，由金算虾再筛。")

        # ---------- 金算虾 (abacus) ----------
        elif agent_id == "abacus":
            if tensor.conversion_focus > 0.7:
                rules.append("- 评分指令: 提高转化相关因子权重，Hot 线速推。")
            if tensor.aggressiveness > 0.6:
                rules.append("- 推送指令: 降低推送阈值，增加推送频次。")
            if tensor.authenticity > 0.7:
                rules.append("- 评分指令: 引入行为拟真度因子，避免「机器人味」线索被高评。")

        # ---------- 回访虾 (follow-up) ----------
        elif agent_id == "follow-up":
            if tensor.aggressiveness > 0.7:
                rules.append("- 回访指令: 接通后快速破冰、直奔加微/转化，话术简洁。")
            if tensor.authenticity > 0.8:
                rules.append("- 话术指令: 语气与节奏偏真人，允许停顿、重复、口语化。")
            if tensor.conversion_focus > 0.6:
                rules.append("- 优先级: 高意向线索秒级触达，低意向延后或仅消息触达。")

        if not rules:
            rules.append("- 通用: 按当前系统策略张量保持稳健执行，兼顾效果与安全。")

        return "\n".join(rules)
