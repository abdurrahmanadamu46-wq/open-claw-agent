#!/usr/bin/env python3
"""
🏪 商业化就绪检查脚本
======================
一键检查项目是否满足商业化上线条件。
输出每个维度的 ✅/❌ 状态和修复建议。

用法: python scripts/check-commercial-readiness.py
"""
from __future__ import annotations
import os, sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DS = ROOT / "dragon-senate-saas-v2"
WEB = ROOT / "web" / "src"
BACKEND = ROOT / "backend"

passed = 0
failed = 0
warnings = 0


def _has_pattern(filepath: Path, pattern: str) -> bool:
    try:
        return pattern in filepath.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return False


def check(label: str, condition: bool, fix: str = ""):
    global passed, failed
    if condition:
        print(f"  ✅ {label}")
        passed += 1
    else:
        print(f"  ❌ {label}" + (f" → {fix}" if fix else ""))
        failed += 1


def warn(label: str, condition: bool, note: str = ""):
    global warnings
    if not condition:
        print(f"  ⚠️  {label}" + (f" — {note}" if note else ""))
        warnings += 1


def main():
    global passed, failed, warnings

    print("=" * 60)
    print("🏪 OpenClaw 商业化就绪检查")
    print("=" * 60)

    # --- 1. 用户/租户体系 ---
    print("\n📦 1. 用户/租户体系")
    check("user_auth.py 存在", (DS / "user_auth.py").exists(), "缺少用户认证模块")
    check("JWT 鉴权实现", _has_pattern(DS / "user_auth.py", "JWTStrategy"), "需要JWT鉴权")
    check("RBAC 角色字段", _has_pattern(DS / "user_auth.py", "roles"), "需要角色字段")
    check("注册页面", (WEB / "app" / "register" / "page.tsx").exists(), "缺少注册页")
    check("登录相关", (WEB / "app" / "forgot-password").exists(), "缺少找回密码")

    # --- 2. 商业化闭环 ---
    print("\n💰 2. 商业化闭环")
    check("billing.py 存在", (DS / "billing.py").exists(), "缺少计费模块")
    check("payment_gateway.py 存在", (DS / "payment_gateway.py").exists(), "缺少支付网关")
    check("pricing 页面", (WEB / "app" / "pricing" / "page.tsx").exists(), "缺少定价页")
    check("billing API endpoint", (WEB / "services" / "endpoints" / "billing.ts").exists(), "前端缺少billing调用")
    check("套餐目录配置", _has_pattern(DS / "billing.py", "_plan_catalog"), "缺少套餐配置")

    # --- 3. 审批与审计 ---
    print("\n🔒 3. 审批与审计")
    check("approval_gate.py 存在", (DS / "approval_gate.py").exists(), "缺少审批门控")
    check("audit_logger.py 存在", (DS / "audit_logger.py").exists(), "缺少审计日志")
    check("constitutional_policy.py 存在", (DS / "constitutional_policy.py").exists(), "缺少宪法策略")
    check("前端审批页面", (WEB / "app" / "operations" / "autopilot" / "approvals").exists(), "缺少审批页面")
    check("前端审计页面", (WEB / "app" / "operations" / "log-audit").exists(), "缺少审计日志页面")

    # --- 4. 部署与运维 ---
    print("\n🐳 4. 部署与运维")
    check("Dockerfile (Python)", (DS / "Dockerfile").exists(), "缺少Python服务Dockerfile")
    check("Dockerfile (Web)", (ROOT / "web" / "Dockerfile").exists(), "缺少Web Dockerfile")
    check("docker-compose.yml", (DS / "docker-compose.yml").exists(), "缺少docker-compose")
    check(".env.example", (DS / ".env.example").exists(), "缺少环境变量模板")
    check("requirements.txt", (DS / "requirements.txt").exists(), "缺少Python依赖清单")

    # --- 5. 合规与站点 ---
    print("\n📋 5. 合规与站点")
    check("隐私政策页面", (WEB / "app" / "legal" / "privacy").exists(), "缺少隐私政策")
    check("服务协议页面", (WEB / "app" / "legal" / "terms").exists(), "缺少服务协议")
    check("ICP备案页面", (WEB / "app" / "legal" / "icp-ready").exists(), "缺少ICP备案就绪页")
    check("FAQ 页面", (WEB / "app" / "faq" / "page.tsx").exists(), "缺少FAQ")
    check("落地页", (WEB / "app" / "landing" / "page.tsx").exists(), "缺少落地页")

    # --- 6. 核心引擎 ---
    print("\n🧠 6. 核心引擎")
    check("dragon_senate.py (主DAG)", (DS / "dragon_senate.py").exists())
    check("campaign_graph.py (策略模拟)", (DS / "campaign_graph.py").exists())
    check("policy_bandit.py (MAB学习)", (DS / "policy_bandit.py").exists())
    check("lossless_memory.py (记忆)", (DS / "lossless_memory.py").exists())
    check("senate_kernel.py (内核)", (DS / "senate_kernel.py").exists())
    check("industry_taxonomy.py (行业分类)", (DS / "industry_taxonomy.py").exists())
    check("edge_agent.py (边缘代理)", (DS / "edge_agent.py").exists())

    # --- 7. 龙虾阵容 ---
    print("\n🦞 7. 龙虾阵容")
    lobsters = ["radar", "strategist", "inkwriter", "visualizer", "dispatcher",
                "echoer", "catcher", "abacus", "followup"]
    for lid in lobsters:
        check(f"lobster-{lid} role-card",
              (ROOT / "packages" / "lobsters" / f"lobster-{lid}" / "role-card.json").exists())

    # --- Summary ---
    total = passed + failed
    print("\n" + "=" * 60)
    print(f"📊 总计: {total} 项检查")
    print(f"   ✅ 通过: {passed}")
    print(f"   ❌ 未通过: {failed}")
    print(f"   ⚠️  警告: {warnings}")
    score = round(passed / total * 100) if total else 0
    print(f"   商业化就绪度: {score}%")
    if score >= 90:
        print("   🎉 商业化基本就绪！")
    elif score >= 70:
        print("   ⚡ 接近就绪，重点补齐❌项")
    else:
        print("   🚧 仍需大量工作")
    print("=" * 60)


if __name__ == "__main__":
    main()
