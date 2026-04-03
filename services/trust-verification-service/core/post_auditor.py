"""
后置审计：边缘节点环境指纹校验
防止「白嫖虾粮」：无头/云手机/虚拟机批量跑任务，毁掉原生 IP 池质量。
"""
from models.schemas import TelemetryData, VerificationResult


# 示例：已知云手机/虚拟机等高危 Canvas 指纹（生产环境由配置或风控库下发）
DEFAULT_BLACKLISTED_CANVAS_HASHES = frozenset([
    "d3b07384d113",
    "e4d909c290d0",
])


class PostExecutionAuditor:
    """边缘节点执行完毕后，携带遥测请求结算前必须通过本审计。"""

    def __init__(self, blacklisted_canvas_hashes: set[str] | None = None):
        self.blacklisted_canvas_hashes = set(
            blacklisted_canvas_hashes or DEFAULT_BLACKLISTED_CANVAS_HASHES
        )

    def audit_telemetry(self, telemetry: TelemetryData) -> VerificationResult:
        """
        后置审计：检查边缘节点的真实性与执行环境是否纯净。
        """
        # 规则 1：WebDriver 暴露（Puppeteer/Selenium 等）
        if telemetry.webdriver_present:
            return VerificationResult(
                is_safe=False,
                risk_score=1.0,
                reason="ENV_ALERT: 检测到活跃的 WebDriver 自动化指纹 (如 Puppeteer/Selenium)",
                action_taken="BAN_NODE_AND_CONFISCATE_REWARD",
            )

        # 规则 2：指纹碰撞（虚拟机/云手机机房）
        if telemetry.canvas_hash in self.blacklisted_canvas_hashes:
            return VerificationResult(
                is_safe=False,
                risk_score=0.99,
                reason="ENV_ALERT: Canvas 指纹命中黑名单，疑似处于虚拟机或云手机机房环境",
                action_taken="BAN_NODE",
            )

        # 规则 3：轨迹真实度（过于平滑/直线即非人类）
        if telemetry.mouse_trajectory_variance < 0.01:
            return VerificationResult(
                is_safe=False,
                risk_score=0.85,
                reason="TRAJECTORY_ALERT: 鼠标轨迹过于平滑或呈绝对直线，非人类物理学特征",
                action_taken="FLAG_NODE_FOR_REVIEW",
            )

        return VerificationResult(
            is_safe=True,
            risk_score=0.05,
            reason="Pass",
            action_taken="SETTLE_REWARD",
        )
