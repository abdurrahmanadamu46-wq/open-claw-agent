"""
策略张量与上下文路由器 — 环境变量与 Redis 配置
生产环境依赖 Redis 维持纳秒级策略状态同步；未配置时回退到进程内内存。
"""
import os
from typing import Optional

# Redis（生产环境必配）
REDIS_URL: Optional[str] = os.environ.get("REDIS_URL")  # 例如 redis://localhost:6379/0
REDIS_POLICY_KEY: str = os.environ.get("REDIS_POLICY_KEY", "lobster:policy:tensor")

# 张量更新超参（可调）
LEARNING_RATE: float = float(os.environ.get("POLICY_LEARNING_RATE", "0.1"))
LAMBDA_REWARD: float = float(os.environ.get("POLICY_LAMBDA_REWARD", "1.0"))
LAMBDA_RISK: float = float(os.environ.get("POLICY_LAMBDA_RISK", "1.5"))

# 服务
HOST: str = os.environ.get("POLICY_HOST", "0.0.0.0")
PORT: int = int(os.environ.get("POLICY_PORT", "8010"))

def use_redis() -> bool:
    return bool(REDIS_URL and REDIS_URL.strip())
