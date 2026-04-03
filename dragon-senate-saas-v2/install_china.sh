#!/usr/bin/env bash
set -euo pipefail

# Dragon Senate CN one-click bootstrap
# - China mirrors for apt/pip/npm/git
# - Docker + Compose
# - pkgx runtime
# - profile-based compose startup

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo bash install_china.sh"
  exit 1
fi

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")" && pwd)}"
START_PROFILES="${START_PROFILES:-core}"
USE_CHINA_MIRROR="${USE_CHINA_MIRROR:-true}"
INSTALL_PKGX="${INSTALL_PKGX:-true}"

echo "[dragon-cn] project_dir=${PROJECT_DIR}"
echo "[dragon-cn] profiles=${START_PROFILES}"

if [[ "${USE_CHINA_MIRROR}" == "true" ]]; then
  echo "[1/8] configure apt mirror (China)"
  if command -v apt-get >/dev/null 2>&1; then
    if [[ -f /etc/apt/sources.list ]]; then
      cp /etc/apt/sources.list /etc/apt/sources.list.bak.$(date +%s) || true
      sed -i 's|http://archive.ubuntu.com/ubuntu/|https://mirrors.aliyun.com/ubuntu/|g' /etc/apt/sources.list || true
      sed -i 's|http://security.ubuntu.com/ubuntu/|https://mirrors.aliyun.com/ubuntu/|g' /etc/apt/sources.list || true
    fi
  fi
fi

echo "[2/8] install base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release git jq

if ! command -v docker >/dev/null 2>&1; then
  echo "[3/8] install docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable docker
systemctl restart docker

if [[ "${INSTALL_PKGX}" == "true" ]]; then
  echo "[4/8] install pkgx"
  if ! command -v pkgx >/dev/null 2>&1; then
    curl -fsSL https://pkgx.sh | sh
    if [[ -x "/root/.pkgx/bin/pkgx" ]]; then
      ln -sf /root/.pkgx/bin/pkgx /usr/local/bin/pkgx
    fi
  fi
fi

echo "[5/8] python pip mirror (China)"
mkdir -p /root/.pip
cat >/root/.pip/pip.conf <<'EOF'
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
trusted-host = pypi.tuna.tsinghua.edu.cn
timeout = 120
EOF

echo "[6/8] npm mirror (China)"
if command -v npm >/dev/null 2>&1; then
  npm config set registry https://registry.npmmirror.com || true
fi

echo "[7/8] ensure .env"
cd "${PROJECT_DIR}"
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

echo "[8/8] docker compose up"
if [[ "${START_PROFILES}" == "core" ]]; then
  docker compose up -d --build
else
  # comma-separated profiles: core,monitoring,telegram,anythingllm,tunnel
  IFS=',' read -ra arr <<<"${START_PROFILES}"
  profile_args=()
  for p in "${arr[@]}"; do
    p_trim="$(echo "$p" | xargs)"
    [[ -z "$p_trim" ]] && continue
    if [[ "$p_trim" != "core" ]]; then
      profile_args+=(--profile "$p_trim")
    fi
  done
  docker compose "${profile_args[@]}" up -d --build
fi

echo "[dragon-cn] done"
echo "health: curl http://127.0.0.1:8000/healthz"
echo "web: http://127.0.0.1:3001"
