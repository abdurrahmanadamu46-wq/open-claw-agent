#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env" && -f ".env.example" ]]; then
  cp ".env.example" ".env"
fi

echo "[server-start] starting lobster full stack"
docker compose -f docker-compose.full.yml up -d --build
echo "[server-start] done"
