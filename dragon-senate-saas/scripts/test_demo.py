#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试 Demo：登录后调用 /run-dragon-team，打印结果。
用法：
  1. 先启动服务：cd dragon-senate-saas && docker compose up -d
  2. 运行本脚本：python scripts/test_demo.py
  或指定 base_url：BASE_URL=http://127.0.0.1:8000 python scripts/test_demo.py
"""
import os
import sys

try:
    import requests
except ImportError:
    print("请先安装: pip install requests")
    sys.exit(1)

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8000")
USERNAME = os.environ.get("DEMO_USER", "admin")
PASSWORD = os.environ.get("DEMO_PASSWORD", "change_me")
USER_ID = os.environ.get("DEMO_USER_ID", "demo_user_001")


def main():
    print(f"[Demo] Base URL: {BASE_URL}")
    print("[Demo] 1. 健康检查...")
    r = requests.get(f"{BASE_URL}/healthz", timeout=5)
    r.raise_for_status()
    print("      OK:", r.json())

    print("[Demo] 2. 登录获取 Token...")
    r = requests.post(
        f"{BASE_URL}/auth/login",
        json={"username": USERNAME, "password": PASSWORD},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json()
    token = data["access_token"]
    print("      OK, expires_in:", data.get("expires_in"))

    print("[Demo] 3. 调用 9 只龙虾 /run-dragon-team...")
    r = requests.post(
        f"{BASE_URL}/run-dragon-team",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "task_description": "分析抖音爆款视频，生成短平快剧本并收网",
            "user_id": USER_ID,
        },
        timeout=60,
    )
    r.raise_for_status()
    out = r.json()
    print("      状态:", out.get("status"))
    print("      request_id:", out.get("request_id"))
    print("      评分 score:", out.get("score"))
    print("      线索数 leads:", len(out.get("leads", [])))
    print("      进化记录 evolution:", out.get("evolution", [])[:2], "...")
    print("[Demo] 完成！")


if __name__ == "__main__":
    try:
        main()
    except requests.exceptions.ConnectionError as e:
        print("连接失败，请先启动服务: docker compose up -d", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print("HTTP 错误:", e.response.status_code, e.response.text, file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print("错误:", e, file=sys.stderr)
        sys.exit(1)
