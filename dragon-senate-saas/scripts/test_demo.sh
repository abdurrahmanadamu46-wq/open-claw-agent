#!/usr/bin/env bash
# 测试 Demo：先登录再调用 /run-dragon-team
# 用法：./scripts/test_demo.sh  或  BASE_URL=http://127.0.0.1:8000 ./scripts/test_demo.sh

set -e
BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"

echo "[Demo] Base URL: $BASE_URL"
echo "[Demo] 1. 健康检查..."
curl -sSf "$BASE_URL/healthz" | head -1

echo "[Demo] 2. 登录..."
TOKEN=$(curl -sS -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"change_me"}' | jq -r '.access_token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "登录失败" >&2
  exit 1
fi

echo "[Demo] 3. 调用 /run-dragon-team..."
curl -sS -X POST "$BASE_URL/run-dragon-team" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task_description":"分析抖音爆款视频，生成短平快剧本并收网","user_id":"demo_user_001"}'

echo ""
echo "[Demo] 完成！"
