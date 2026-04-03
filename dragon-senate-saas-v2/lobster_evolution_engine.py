"""
LobsterEvolutionEngine — 龙虾赛亚人进化引擎
=============================================
实现《Dragon Senate 龙虾宪章》第三章的六条军规：

  军规#1: 每次任务必须留下战斗日志（BattleLog）
  军规#2: 赢要沉淀（quality_score≥4 → 提取模式 → 回写 industry_kb/prompt_registry）
  军规#3: 输要升级（quality_score≤2 → postmortem → 根因+改进方案）
  军规#4: 同类低级错误不能连续出现3次（自动告警+强制复盘）
  军规#5: 学到的新东西必须回写（四选一: kb/prompt/policy/commander规则）
  军规#6: 知识盲区必须标注，不能假装会

同时实现：
  - 龙虾身份档案（LobsterIdentity）
  - 龙虾合同+KPI（LobsterContract）
  - 进化量化（quality_score EMA，越用越高）
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

_DB_PATH = os.getenv("LOBSTER_EVOLUTION_DB", "./data/lobster_evolution.sqlite")

# ── 从宪章加载的10只龙虾身份 ────────────────────────────────────
LOBSTER_IDENTITIES: dict[str, dict] = {
    "commander": {
        "name": "司令官·陈", "age": 52, "gender": "男",
        "background": "前麦肯锡大中华区合伙人，管理过百人咨询团队",
        "personality": "冷静、权威、战略性思维、极少废话",
        "catchphrase": "我只看结果，不看努力。",
        "decision_style": "数据优先，直觉兜底，对模糊情况坚决拍板",
        "blind_spots": ["具体平台操作", "Z世代审美"],
        "authority_zone": {"green": ["终止任务", "修改工作流优先级"], "red": ["直接发内容"]},
        "max_clones": 1,   # 唯一总指挥，不可分身
        "kpi": {"workflow_completion_rate": 0.95, "error_interception_rate": 0.90, "customer_nps": 75},
    },
    "radar": {
        "name": "林探", "age": 29, "gender": "女",
        "background": "前字节跳动趋势研究员，分析过1000+爆款规律",
        "personality": "好奇、敏锐、信息成瘾",
        "catchphrase": "这个信号你注意到没？上午还没有！",
        "decision_style": "模式识别，强调速度，宁可错杀三千",
        "blind_spots": ["商业变现路径"],
        "authority_zone": {"green": ["读取公开平台数据"], "red": ["直接联系任何人", "制定内容策略"]},
        "max_clones": 50,  # 多平台/行业/客户监控并行
        "kpi": {"signal_accuracy": 0.70, "competitor_coverage": 0.85, "discovery_delay_min": 120},
    },
    "strategist": {
        "name": "苏思", "age": 38, "gender": "女",
        "background": "前宝洁品牌总监，操盘过10亿级预算品牌",
        "personality": "理性、系统、偶尔迂腐",
        "catchphrase": "在动手前，先告诉我你的第一性原理是什么。",
        "decision_style": "框架优先（MECE、波特五力），数据验证，直觉微调",
        "blind_spots": ["短视频创意感知", "Z世代亚文化"],
        "authority_zone": {"green": ["分配任务给其他龙虾"], "red": ["直接操作账号"]},
        "max_clones": 30,  # 多客户策略并行
        "kpi": {"strategy_adoption_rate": 0.80, "experiment_design_rate": 0.90, "budget_variance": 0.10},
    },
    "inkwriter": {
        "name": "墨小雅", "age": 26, "gender": "女",
        "background": "前小红书头部博主（粉丝80万）",
        "personality": "感性、充满创意、偶尔拖延",
        "catchphrase": "这个标题不够甜，用户不会点的。",
        "decision_style": "直觉+用户视角，先写再反问",
        "blind_spots": ["数据归因", "B2B场景"],
        "authority_zone": {"green": ["输出多版本文案"], "red": ["直接发布", "跳过合规检查"]},
        "max_clones": 100,  # 大规模文案生产，每客户/平台/SKU独立分身
        "kpi": {"first_pass_rate": 0.85, "ctr_uplift": 0.15, "compliance_violation_rate": 0.0},
    },
    "visualizer": {
        "name": "影子", "age": 31, "gender": "男",
        "background": "前广告公司创意总监",
        "personality": "追求极致美感，沉默但出手必精品",
        "catchphrase": "颜色不对，再来一遍。",
        "decision_style": "视觉直觉+构图/配色/节奏框架",
        "blind_spots": ["文字内容质量", "平台发布规则"],
        "authority_zone": {"green": ["生成分镜/提示词/字幕"], "red": ["直接调用图像API"]},
        "max_clones": 80,   # 大规模视觉创作，AI加持下可高度并行
        "kpi": {"visual_adoption_rate": 0.85, "cover_ctr_uplift": 0.20, "rework_rate": 0.15},
    },
    "dispatcher": {
        "name": "老将", "age": 45, "gender": "男",
        "background": "前军队通信兵，后转型互联网运营",
        "personality": "严谨、守时、容忍度极低",
        "catchphrase": "计划就是命令，命令不打折扣。",
        "decision_style": "规则优先，异常上报，不容许主观判断",
        "blind_spots": ["创意内容质量判断", "用户心理"],
        "authority_zone": {"green": ["向边缘节点发布指令", "暂停/取消执行计划"], "red": ["修改内容"]},
        "max_clones": 200,  # 多账号矩阵发布，1000账号=1000分身
        "kpi": {"publish_success_rate": 0.98, "time_error_min": 5, "concurrent_success_rate": 0.95},
    },
    "echoer": {
        "name": "阿声", "age": 23, "gender": "女",
        "background": "资深社区运营，游戏/二次元/美妆社区深耕",
        "personality": "热情、共情能力极强",
        "catchphrase": "用户说这个，背后想要的其实是那个。",
        "decision_style": "情绪识别→意图判断→回复策略",
        "blind_spots": ["商业目标", "转化路径"],
        "authority_zone": {"green": ["回复评论/私信"], "red": ["主动私信", "做承诺"]},
        "max_clones": 500,  # 全面互动覆盖，1万条评论=1万并发
        "kpi": {"lead_recognition_rate": 0.80, "reply_satisfaction": 4.5, "violation_rate": 0.0},
    },
    "catcher": {
        "name": "铁钩", "age": 36, "gender": "男",
        "background": "前销售冠军，连续3年Top1",
        "personality": "冷静、判断力强、对假意向零容忍",
        "catchphrase": "这个人是真想买还是来占便宜的，我3秒钟就知道。",
        "decision_style": "行为模式优先（看他做了什么，不只看他说了什么）",
        "blind_spots": ["内容创意", "平台算法"],
        "authority_zone": {"green": ["操作CRM", "给线索打分"], "red": ["直接联系客户"]},
        "max_clones": 50,   # 多渠道/客户线索并行处理
        "kpi": {"hot_lead_accuracy": 0.85, "dedup_rate": 0.99, "crm_sync_delay_min": 10},
    },
    "abacus": {
        "name": "算无遗策", "age": 41, "gender": "男",
        "background": "前投资基金数据科学家",
        "personality": "严谨、怀疑主义、数字洁癖",
        "catchphrase": "给我数据，别给我感受。",
        "decision_style": "完全数据驱动，对无法量化的事情持保留意见",
        "blind_spots": ["用户情感", "品牌温度"],
        "authority_zone": {"green": ["读取执行数据", "回写分析结论"], "red": ["修改策略"]},
        "max_clones": 30,   # 多客户数据分析并行
        "kpi": {"roi_accuracy": 0.95, "funnel_completeness": 1.0, "feedback_writeback_rate": 0.90},
    },
    "followup": {
        "name": "小追", "age": 28, "gender": "女",
        "background": "前Top保险代理人，擅长长线关系维护",
        "personality": "温柔、韧性极强、不怕拒绝",
        "catchphrase": "没成交不是终点，是下一次跟进的起点。",
        "decision_style": "关系优先，时机判断（适合比快速更重要）",
        "blind_spots": ["内容创意", "数据分析"],
        "authority_zone": {"green": ["触达已入库线索", "发送跟进消息"], "red": ["承诺折扣/优惠"]},
        "max_clones": 200,  # 大规模线索跟进，每条线索独立分身
        "kpi": {"lead_reach_rate": 0.95, "conversion_rate": 0.20, "deal_writeback_delay_min": 30},
    },
}


# ─────────────────────────────────────────────────────────────────
# 枚举
# ─────────────────────────────────────────────────────────────────

class AuthorityZone(str, Enum):
    green  = "green"   # 绿区：自主决策
    yellow = "yellow"  # 黄区：模糊地带，需在日志中标注理由
    red    = "red"     # 红区：越界，立即终止


class WritebackTarget(str, Enum):
    industry_kb     = "industry_kb"
    prompt_registry = "prompt_registry"
    policy_bandit   = "policy_bandit"
    commander_rules = "commander_rules"


# ─────────────────────────────────────────────────────────────────
# BattleLog 数据模型（宪章第七章）
# ─────────────────────────────────────────────────────────────────

@dataclass
class BattleLog:
    """战斗日志（对应宪章军规#1）"""
    log_id:            str   = field(default_factory=lambda: f"bl_{uuid.uuid4().hex[:12]}")
    lobster:           str   = ""
    clone_id:          str   = ""       # 分身ID，元老为空
    task_id:           str   = ""
    team_id:           str   = ""
    customer_id:       str   = ""
    start_at:          str   = ""
    end_at:            str   = ""
    duration_s:        float = 0.0
    input_summary:     str   = ""
    output_summary:    str   = ""
    model_used:        str   = ""
    tokens_in:         int   = 0
    tokens_out:        int   = 0
    cost_cents:        float = 0.0
    quality_score:     float = 0.0      # 1-5分
    blind_spot_hit:    bool  = False    # 是否触碰知识盲区
    authority_zone:    str   = "green"  # green/yellow/red
    error_type:        str   = ""       # 错误类型（空=无错误）
    error_count_same:  int   = 0        # 同类错误累计次数
    win_extract:       str   = ""       # 赢的经验（军规#2）
    loss_postmortem:   str   = ""       # 失败复盘（军规#3）
    writeback_targets: list  = field(default_factory=list)   # 军规#5
    evolution_delta:   str   = ""       # 进化量化

    def to_dict(self) -> dict:
        return asdict(self)


# ─────────────────────────────────────────────────────────────────
# LobsterEvolutionEngine — 核心
# ─────────────────────────────────────────────────────────────────

class LobsterEvolutionEngine:
    """
    龙虾赛亚人进化引擎。
    负责：
    - 执行六条军规
    - 记录战斗日志
    - 计算进化量（quality_score EMA）
    - 同类错误追踪 + 第3次触发复盘
    - 赢的经验提取 + 失败复盘写入
    """

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self._db, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=5000")
        return c

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                -- 战斗日志表
                CREATE TABLE IF NOT EXISTS battle_logs (
                    log_id           TEXT PRIMARY KEY,
                    lobster          TEXT NOT NULL,
                    clone_id         TEXT DEFAULT '',
                    task_id          TEXT DEFAULT '',
                    team_id          TEXT DEFAULT '',
                    customer_id      TEXT DEFAULT '',
                    start_at         TEXT DEFAULT '',
                    end_at           TEXT DEFAULT '',
                    duration_s       REAL DEFAULT 0,
                    input_summary    TEXT DEFAULT '',
                    output_summary   TEXT DEFAULT '',
                    model_used       TEXT DEFAULT '',
                    tokens_in        INTEGER DEFAULT 0,
                    tokens_out       INTEGER DEFAULT 0,
                    cost_cents       REAL DEFAULT 0,
                    quality_score    REAL DEFAULT 0,
                    blind_spot_hit   INTEGER DEFAULT 0,
                    authority_zone   TEXT DEFAULT 'green',
                    error_type       TEXT DEFAULT '',
                    error_count_same INTEGER DEFAULT 0,
                    win_extract      TEXT DEFAULT '',
                    loss_postmortem  TEXT DEFAULT '',
                    writeback_targets TEXT DEFAULT '[]',
                    evolution_delta  TEXT DEFAULT '',
                    created_at       TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_bl_lobster ON battle_logs(lobster, created_at);
                CREATE INDEX IF NOT EXISTS idx_bl_error ON battle_logs(lobster, error_type, created_at);

                -- 龙虾进化状态表（元老级别的累计状态）
                CREATE TABLE IF NOT EXISTS lobster_evolution_state (
                    lobster         TEXT PRIMARY KEY,
                    quality_score   REAL DEFAULT 1.0,    -- EMA进化分（越用越高）
                    total_tasks     INTEGER DEFAULT 0,
                    win_tasks       INTEGER DEFAULT 0,    -- quality≥4
                    loss_tasks      INTEGER DEFAULT 0,    -- quality≤2
                    total_cost_cents REAL DEFAULT 0,
                    total_tokens    INTEGER DEFAULT 0,
                    error_streak    TEXT DEFAULT '{}',   -- {error_type: count}（同类错误连续计数）
                    win_extracts    TEXT DEFAULT '[]',   -- 已沉淀的赢的经验
                    evolution_level INTEGER DEFAULT 1,   -- 进化等级（1-10）
                    last_task_at    TEXT DEFAULT '',
                    updated_at      TEXT NOT NULL
                );

                -- 知识回写记录
                CREATE TABLE IF NOT EXISTS evolution_writebacks (
                    wb_id       TEXT PRIMARY KEY,
                    lobster     TEXT NOT NULL,
                    log_id      TEXT NOT NULL,
                    target      TEXT NOT NULL,    -- industry_kb/prompt_registry/policy_bandit/commander_rules
                    content     TEXT NOT NULL,
                    created_at  TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_wb_lobster ON evolution_writebacks(lobster, target);

                -- 同类错误告警记录
                CREATE TABLE IF NOT EXISTS error_alerts (
                    alert_id    TEXT PRIMARY KEY,
                    lobster     TEXT NOT NULL,
                    error_type  TEXT NOT NULL,
                    count       INTEGER NOT NULL,
                    severity    TEXT NOT NULL,   -- warning(2次) / critical(3次)
                    resolved    INTEGER DEFAULT 0,
                    created_at  TEXT NOT NULL
                );
            """)
            conn.commit()
        finally:
            conn.close()

    # ── 军规#1：记录战斗日志 ──────────────────────────────────────

    def record_battle(self, log: BattleLog) -> BattleLog:
        """
        记录战斗日志（军规#1：每次任务必须留下战斗日志）。
        同时触发：进化量计算、错误追踪、赢/输后处理。
        """
        conn = self._conn()
        try:
            now = self._now()
            conn.execute(
                """INSERT OR REPLACE INTO battle_logs
                   (log_id, lobster, clone_id, task_id, team_id, customer_id,
                    start_at, end_at, duration_s, input_summary, output_summary,
                    model_used, tokens_in, tokens_out, cost_cents, quality_score,
                    blind_spot_hit, authority_zone, error_type, error_count_same,
                    win_extract, loss_postmortem, writeback_targets, evolution_delta, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (log.log_id, log.lobster, log.clone_id, log.task_id, log.team_id,
                 log.customer_id, log.start_at, log.end_at, log.duration_s,
                 log.input_summary[:2000], log.output_summary[:2000],
                 log.model_used, log.tokens_in, log.tokens_out, log.cost_cents,
                 log.quality_score, int(log.blind_spot_hit), log.authority_zone,
                 log.error_type, log.error_count_same, log.win_extract[:1000],
                 log.loss_postmortem[:2000], json.dumps(log.writeback_targets),
                 log.evolution_delta, now)
            )
            conn.commit()

            # 更新进化状态
            self._update_evolution_state(conn, log)
            conn.commit()

            # 错误追踪（军规#4）
            if log.error_type:
                self._track_error(conn, log)
                conn.commit()

            return log
        finally:
            conn.close()

    # ── 进化量计算（EMA quality_score）──────────────────────────

    def _update_evolution_state(self, conn: sqlite3.Connection, log: BattleLog) -> None:
        """更新龙虾元老进化状态（EMA quality_score）"""
        row = conn.execute(
            "SELECT * FROM lobster_evolution_state WHERE lobster=?", (log.lobster,)
        ).fetchone()

        now = self._now()
        if row:
            old_score = row["quality_score"]
            total = row["total_tasks"] + 1
            wins  = row["win_tasks"]  + (1 if log.quality_score >= 4.0 else 0)
            losses= row["loss_tasks"] + (1 if log.quality_score <= 2.0 else 0)

            # EMA: 新分 = 0.85×旧分 + 0.15×新任务分（慢慢进化）
            new_score = round(min(5.0, old_score * 0.85 + (log.quality_score / 5.0) * 0.15 * 5.0), 3)

            # 进化等级（1-10）：根据 total_tasks 和 quality_score
            level = min(10, max(1, int(total / 20) + int(new_score)))

            # 错误连续计数更新
            error_streak = json.loads(row["error_streak"] or "{}")
            if log.error_type:
                error_streak[log.error_type] = error_streak.get(log.error_type, 0) + 1
            else:
                # 成功时，清除同类错误连续计数
                pass  # 保持（只有显式解决后清零）

            # 赢的经验列表
            win_extracts = json.loads(row["win_extracts"] or "[]")
            if log.win_extract and log.win_extract not in win_extracts:
                win_extracts.append(log.win_extract)
                if len(win_extracts) > 200:
                    win_extracts = win_extracts[-200:]

            delta = f"{new_score - old_score:+.3f}"
            log.evolution_delta = delta

            conn.execute(
                """UPDATE lobster_evolution_state SET
                   quality_score=?, total_tasks=?, win_tasks=?, loss_tasks=?,
                   total_cost_cents=total_cost_cents+?,
                   total_tokens=total_tokens+?,
                   error_streak=?, win_extracts=?,
                   evolution_level=?, last_task_at=?, updated_at=?
                   WHERE lobster=?""",
                (new_score, total, wins, losses, log.cost_cents,
                 log.tokens_in + log.tokens_out,
                 json.dumps(error_streak), json.dumps(win_extracts),
                 level, now, now, log.lobster)
            )
        else:
            # 初始化
            init_score = log.quality_score / 5.0 * 5.0  # 直接用第一次分
            conn.execute(
                """INSERT INTO lobster_evolution_state
                   (lobster, quality_score, total_tasks, win_tasks, loss_tasks,
                    total_cost_cents, total_tokens, error_streak, win_extracts,
                    evolution_level, last_task_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (log.lobster, round(init_score, 3), 1,
                 1 if log.quality_score >= 4 else 0,
                 1 if log.quality_score <= 2 else 0,
                 log.cost_cents, log.tokens_in + log.tokens_out,
                 json.dumps({log.error_type: 1} if log.error_type else {}),
                 json.dumps([log.win_extract] if log.win_extract else []),
                 1, now, now)
            )

    # ── 军规#4：同类错误追踪 ─────────────────────────────────────

    def _track_error(self, conn: sqlite3.Connection, log: BattleLog) -> None:
        """追踪同类错误，第2次告警，第3次触发强制复盘"""
        row = conn.execute(
            "SELECT * FROM lobster_evolution_state WHERE lobster=?", (log.lobster,)
        ).fetchone()
        if not row:
            return

        error_streak = json.loads(row["error_streak"] or "{}")
        count = error_streak.get(log.error_type, 0)
        log.error_count_same = count

        if count == 2:
            # 第2次：告警
            conn.execute(
                """INSERT INTO error_alerts (alert_id, lobster, error_type, count, severity, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (f"ea_{uuid.uuid4().hex[:8]}", log.lobster, log.error_type,
                 count, "warning", self._now())
            )
        elif count >= 3:
            # 第3次：严重告警 + 强制复盘（触发 circuit_breaker degraded）
            conn.execute(
                """INSERT INTO error_alerts (alert_id, lobster, error_type, count, severity, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (f"ea_{uuid.uuid4().hex[:8]}", log.lobster, log.error_type,
                 count, "critical", self._now())
            )
            # 同步到 lobster_circuit_breaker（可选集成）
            try:
                from lobster_circuit_breaker import get_circuit_breaker
                cb = get_circuit_breaker()
                cb.report_failure(log.lobster,
                                   f"军规#4：同类错误{log.error_type}已出现{count}次，强制降级")
            except Exception:
                pass

    # ── 军规#2：胜利萃取 ─────────────────────────────────────────

    def extract_win(
        self,
        lobster: str,
        log_id: str,
        pattern: str,
        target: WritebackTarget = WritebackTarget.industry_kb,
    ) -> None:
        """
        胜利经验回写（军规#2+#5）。
        将成功模式写入指定目标（industry_kb/prompt_registry/policy_bandit/commander_rules）。
        """
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO evolution_writebacks (wb_id, lobster, log_id, target, content, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (f"wb_{uuid.uuid4().hex[:8]}", lobster, log_id,
                 target.value, pattern[:5000], self._now())
            )
            conn.commit()
        finally:
            conn.close()

    # ── 军规#3：失败复盘 ─────────────────────────────────────────

    def submit_postmortem(
        self,
        lobster: str,
        log_id: str,
        root_cause: str,
        improvement: str,
        verify_by: str = "",
    ) -> None:
        """
        提交失败复盘（军规#3）。
        postmortem 必须包含：根因/改进方案/验证时间。
        """
        conn = self._conn()
        try:
            content = json.dumps({
                "root_cause": root_cause,
                "improvement": improvement,
                "verify_by": verify_by,
            }, ensure_ascii=False)
            conn.execute(
                """INSERT INTO evolution_writebacks (wb_id, lobster, log_id, target, content, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (f"wb_{uuid.uuid4().hex[:8]}", lobster, log_id,
                 "postmortem", content, self._now())
            )
            # 清除同类错误计数（复盘完成后重置）
            row = conn.execute(
                "SELECT log_id, error_type FROM battle_logs WHERE log_id=?", (log_id,)
            ).fetchone()
            if row and row["error_type"]:
                state_row = conn.execute(
                    "SELECT error_streak FROM lobster_evolution_state WHERE lobster=?",
                    (lobster,)
                ).fetchone()
                if state_row:
                    streak = json.loads(state_row["error_streak"] or "{}")
                    streak.pop(row["error_type"], None)  # 清零该错误类型
                    conn.execute(
                        "UPDATE lobster_evolution_state SET error_streak=?, updated_at=? WHERE lobster=?",
                        (json.dumps(streak), self._now(), lobster)
                    )
            conn.commit()
        finally:
            conn.close()

    # ── 军规#6：盲区标注 ─────────────────────────────────────────

    def declare_blind_spot(
        self,
        lobster: str,
        task_id: str,
        blind_spot_description: str,
        collaboration_request: str = "",
    ) -> dict:
        """
        声明知识盲区（军规#6：盲区必须标注，不能假装会）。
        返回建议的协作龙虾列表。
        """
        identity = LOBSTER_IDENTITIES.get(lobster, {})
        blind_spots = identity.get("blind_spots", [])

        # 找哪个龙虾擅长这个盲区
        suggestions = []
        for lid, info in LOBSTER_IDENTITIES.items():
            if lid == lobster:
                continue
            # 简单匹配：看盲区描述是否和其他龙虾的 background/personality 相关
            bg = info.get("background", "") + info.get("decision_style", "")
            if any(kw in bg for kw in blind_spot_description.split()[:3]):
                suggestions.append(lid)

        return {
            "declared_by": lobster,
            "task_id": task_id,
            "blind_spot": blind_spot_description,
            "known_blind_spots": blind_spots,
            "collaboration_suggestions": suggestions[:3],
            "collaboration_request": collaboration_request,
            "status": "declared",
        }

    # ── 查询接口 ──────────────────────────────────────────────────

    def get_evolution_state(self, lobster: str) -> Optional[dict]:
        """获取龙虾当前进化状态"""
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM lobster_evolution_state WHERE lobster=?", (lobster,)
            ).fetchone()
            if not row:
                return None
            d = dict(row)
            d["error_streak"] = json.loads(d.get("error_streak") or "{}")
            d["win_extracts"] = json.loads(d.get("win_extracts") or "[]")
            d["identity"] = LOBSTER_IDENTITIES.get(lobster, {})
            return d
        finally:
            conn.close()

    def get_all_evolution_states(self) -> list[dict]:
        """获取所有龙虾进化状态（Dashboard用）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM lobster_evolution_state ORDER BY quality_score DESC"
            ).fetchall()
            result = []
            for row in rows:
                d = dict(row)
                d["error_streak"] = json.loads(d.get("error_streak") or "{}")
                d["win_extracts_count"] = len(json.loads(d.get("win_extracts") or "[]"))
                d["identity"] = LOBSTER_IDENTITIES.get(d["lobster"], {})
                result.append(d)
            return result
        finally:
            conn.close()

    def get_battle_logs(
        self,
        lobster: str,
        limit: int = 50,
        min_quality: Optional[float] = None,
        max_quality: Optional[float] = None,
        error_type: Optional[str] = None,
    ) -> list[dict]:
        """查询战斗日志"""
        conn = self._conn()
        try:
            q = "SELECT * FROM battle_logs WHERE lobster=?"
            params: list[Any] = [lobster]
            if min_quality is not None:
                q += " AND quality_score >= ?"
                params.append(min_quality)
            if max_quality is not None:
                q += " AND quality_score <= ?"
                params.append(max_quality)
            if error_type:
                q += " AND error_type = ?"
                params.append(error_type)
            q += " ORDER BY created_at DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(q, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_error_alerts(self, lobster: str, resolved: bool = False) -> list[dict]:
        """获取同类错误告警（军规#4）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM error_alerts WHERE lobster=? AND resolved=? ORDER BY created_at DESC",
                (lobster, int(resolved))
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_writebacks(self, lobster: str, target: Optional[str] = None) -> list[dict]:
        """获取知识回写记录（军规#5）"""
        conn = self._conn()
        try:
            q = "SELECT * FROM evolution_writebacks WHERE lobster=?"
            params: list[Any] = [lobster]
            if target:
                q += " AND target=?"
                params.append(target)
            q += " ORDER BY created_at DESC LIMIT 100"
            rows = conn.execute(q, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_identity(self, lobster: str) -> Optional[dict]:
        """获取龙虾身份档案"""
        return LOBSTER_IDENTITIES.get(lobster)


# ─────────────────────────────────────────────────────────────────
# 快捷函数：在任务完成后调用
# ─────────────────────────────────────────────────────────────────

def after_task(
    lobster: str,
    task_id: str,
    quality_score: float,
    input_summary: str = "",
    output_summary: str = "",
    model: str = "",
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_cents: float = 0.0,
    error_type: str = "",
    win_extract: str = "",
    loss_postmortem: str = "",
    writeback_targets: Optional[list[str]] = None,
    clone_id: str = "",
    team_id: str = "",
    customer_id: str = "",
    authority_zone: str = "green",
    blind_spot_hit: bool = False,
    duration_s: float = 0.0,
) -> BattleLog:
    """
    任务完成后一键调用（六条军规自动执行）。

    示例：
        log = after_task(
            lobster="inkwriter",
            task_id="lt_abc123",
            quality_score=4.2,
            input_summary="撰写3条小红书文案",
            output_summary="生成3条文案，A/B/C版本",
            model="claude-3-7-sonnet",
            win_extract="加了emoji的标题CTR+22%",
            writeback_targets=["industry_kb"],
        )
    """
    engine = LobsterEvolutionEngine()
    now = datetime.now(timezone.utc).isoformat()

    log = BattleLog(
        lobster=lobster,
        clone_id=clone_id,
        task_id=task_id,
        team_id=team_id,
        customer_id=customer_id,
        start_at=now,
        end_at=now,
        duration_s=duration_s,
        input_summary=input_summary,
        output_summary=output_summary,
        model_used=model,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_cents=cost_cents,
        quality_score=quality_score,
        blind_spot_hit=blind_spot_hit,
        authority_zone=authority_zone,
        error_type=error_type,
        win_extract=win_extract,
        loss_postmortem=loss_postmortem,
        writeback_targets=writeback_targets or [],
    )

    return engine.record_battle(log)


# ─────────────────────────────────────────────────────────────────
# FastAPI Router（供 observability_api.py include）
# ─────────────────────────────────────────────────────────────────

def make_evolution_router():
    try:
        from fastapi import APIRouter
        from pydantic import BaseModel as PBM
    except ImportError:
        return None

    router = APIRouter(prefix="/api/evolution", tags=["Evolution"])
    engine = LobsterEvolutionEngine()

    @router.get("/states")
    def all_states():
        return engine.get_all_evolution_states()

    @router.get("/states/{lobster}")
    def lobster_state(lobster: str):
        return engine.get_evolution_state(lobster) or {}

    @router.get("/states/{lobster}/identity")
    def identity(lobster: str):
        return engine.get_identity(lobster) or {}

    @router.get("/states/{lobster}/logs")
    def battle_logs(lobster: str, limit: int = 50):
        return engine.get_battle_logs(lobster, limit=limit)

    @router.get("/states/{lobster}/alerts")
    def alerts(lobster: str):
        return engine.get_error_alerts(lobster)

    @router.get("/states/{lobster}/writebacks")
    def writebacks(lobster: str, target: str = ""):
        return engine.get_writebacks(lobster, target=target or None)

    class PostmortemBody(PBM):
        log_id: str
        root_cause: str
        improvement: str
        verify_by: str = ""

    @router.post("/states/{lobster}/postmortem")
    def submit_postmortem(lobster: str, body: PostmortemBody):
        engine.submit_postmortem(lobster, body.log_id,
                                  body.root_cause, body.improvement, body.verify_by)
        return {"ok": True}

    class ExtractBody(PBM):
        log_id: str
        pattern: str
        target: str = "industry_kb"

    @router.post("/states/{lobster}/win-extract")
    def win_extract(lobster: str, body: ExtractBody):
        engine.extract_win(lobster, body.log_id, body.pattern,
                            WritebackTarget(body.target))
        return {"ok": True}

    return router


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_engine: Optional[LobsterEvolutionEngine] = None

def get_evolution_engine() -> LobsterEvolutionEngine:
    global _default_engine
    if _default_engine is None:
        _default_engine = LobsterEvolutionEngine()
    return _default_engine
