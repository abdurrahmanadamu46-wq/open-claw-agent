#!/usr/bin/env bash
set -euo pipefail

# One-click deploy for Aliyun ECS (Ubuntu 22.04+)
# Includes:
# - docker + compose plugin
# - pkgx standalone runtime + dragon-edge shim
# - git clone/pull
# - .env setup
# - docker compose up
# - nginx reverse proxy
# - let's encrypt https

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo bash deploy.sh"
  exit 1
fi

REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"
APP_ROOT="${APP_ROOT:-/opt/dragon-senate-saas-v2}"
PROJECT_SUBDIR="${PROJECT_SUBDIR:-dragon-senate-saas-v2}"
DOMAIN="${DOMAIN:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
PKGX_INSTALL="${PKGX_INSTALL:-true}"
PKGX_BIN_PATH="${PKGX_BIN_PATH:-/usr/local/bin/pkgx}"
DRAGON_DEV_BOOTSTRAP="${DRAGON_DEV_BOOTSTRAP:-false}"
DRAGON_INIT_AFTER_DEPLOY="${DRAGON_INIT_AFTER_DEPLOY:-false}"

read -r -p "Git repo url (https://...): " INPUT_REPO_URL
if [[ -n "${INPUT_REPO_URL}" ]]; then
  REPO_URL="${INPUT_REPO_URL}"
fi
if [[ -z "${REPO_URL}" ]]; then
  echo "REPO_URL is required."
  exit 1
fi

read -r -p "Domain for HTTPS (e.g. senate.example.com): " INPUT_DOMAIN
if [[ -n "${INPUT_DOMAIN}" ]]; then
  DOMAIN="${INPUT_DOMAIN}"
fi
if [[ -z "${DOMAIN}" ]]; then
  echo "DOMAIN is required."
  exit 1
fi

read -r -p "Let's Encrypt email: " INPUT_EMAIL
if [[ -n "${INPUT_EMAIL}" ]]; then
  LETSENCRYPT_EMAIL="${INPUT_EMAIL}"
fi
if [[ -z "${LETSENCRYPT_EMAIL}" ]]; then
  echo "LETSENCRYPT_EMAIL is required."
  exit 1
fi

echo "[1/8] Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release git nginx certbot python3-certbot-nginx

if ! command -v docker >/dev/null 2>&1; then
  echo "[2/8] Installing Docker..."
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

echo "[3/8] Enabling Docker..."
systemctl enable docker
systemctl restart docker

if [[ "${PKGX_INSTALL}" == "true" ]]; then
  echo "[3.5/8] Installing pkgx runtime..."
  if [[ ! -x "${PKGX_BIN_PATH}" ]]; then
    curl -fsSL https://pkgx.sh | sh
    if [[ -x "/root/.pkgx/bin/pkgx" ]]; then
      ln -sf "/root/.pkgx/bin/pkgx" "${PKGX_BIN_PATH}"
    fi
  fi
  if command -v pkgx >/dev/null 2>&1; then
    pkgx --version || true
  fi
fi

echo "[4/8] Pulling project..."
mkdir -p "${APP_ROOT}"
if [[ ! -d "${APP_ROOT}/.git" ]]; then
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_ROOT}"
else
  git -C "${APP_ROOT}" fetch origin
  git -C "${APP_ROOT}" checkout "${BRANCH}"
  git -C "${APP_ROOT}" pull --ff-only origin "${BRANCH}"
fi

PROJECT_DIR="${APP_ROOT}/${PROJECT_SUBDIR}"
if [[ ! -d "${PROJECT_DIR}" ]]; then
  echo "Project dir not found: ${PROJECT_DIR}"
  exit 1
fi
cd "${PROJECT_DIR}"

echo "[5/8] Preparing .env..."
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

read -r -p "DATABASE_URL (Aliyun RDS): " DATABASE_URL
read -r -p "OPENAI_API_KEY: " OPENAI_API_KEY
read -r -p "CLAWHUB_KEYS (json): " CLAWHUB_KEYS
read -r -p "JWT_SECRET: " JWT_SECRET
read -r -p "APP_USERS_JSON (json array): " APP_USERS_JSON
read -r -p "EDGE_SHARED_SECRET: " EDGE_SHARED_SECRET

update_env() {
  local key="$1"
  local value="$2"
  local escaped
  escaped=$(printf '%s' "${value}" | sed -e 's/[\/&]/\\&/g')
  if grep -q "^${key}=" .env; then
    sed -i "s/^${key}=.*/${key}=${escaped}/" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

update_env "DATABASE_URL" "${DATABASE_URL}"
update_env "OPENAI_API_KEY" "${OPENAI_API_KEY}"
update_env "CLAWHUB_KEYS" "${CLAWHUB_KEYS}"
update_env "JWT_SECRET" "${JWT_SECRET}"
update_env "APP_USERS_JSON" "${APP_USERS_JSON}"
update_env "EDGE_SHARED_SECRET" "${EDGE_SHARED_SECRET}"

echo "[6/8] Starting app container..."
docker compose up -d --build

echo "[6.5/8] Creating dragon-edge shim..."
mkdir -p /usr/local/bin
if command -v pkgm >/dev/null 2>&1; then
  if pkgm shim dragon-edge -- "${PKGX_BIN_PATH} +python@3.12 -- python ${PROJECT_DIR}/edge_agent.py" >/dev/null 2>&1; then
    echo "[deploy] pkgm shim created: dragon-edge"
  fi
fi

cat >/usr/local/bin/dragon-edge <<EOF
#!/usr/bin/env -S pkgx +python@3.12 python
${PROJECT_DIR}/edge_agent.py "\$@"
EOF
chmod +x /usr/local/bin/dragon-edge

cat >/usr/local/bin/dragon <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec ${PROJECT_DIR}/dragon "\$@"
EOF
chmod +x /usr/local/bin/dragon

if [[ "${DRAGON_DEV_BOOTSTRAP}" == "true" ]]; then
  echo "[6.8/8] Running dragon dev bootstrap (pkgx cache warm-up)..."
  /usr/local/bin/dragon dev || true
fi
if [[ "${DRAGON_INIT_AFTER_DEPLOY}" == "true" ]]; then
  echo "[6.9/8] Running dragon init (first-run onboarding)..."
  /usr/local/bin/dragon init || true
fi

echo "[7/8] Configuring nginx..."
cat >/etc/nginx/sites-available/dragon-senate-v2.conf <<EOF
server {
  listen 80;
  server_name ${DOMAIN};
  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF

ln -sf /etc/nginx/sites-available/dragon-senate-v2.conf /etc/nginx/sites-enabled/dragon-senate-v2.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "[8/8] Issuing https cert..."
certbot --nginx \
  --non-interactive \
  --agree-tos \
  --email "${LETSENCRYPT_EMAIL}" \
  -d "${DOMAIN}" \
  --redirect

if [[ -f nginx.conf ]]; then
  sed "s/__DOMAIN__/${DOMAIN}/g" nginx.conf >/etc/nginx/sites-available/dragon-senate-v2.conf
  nginx -t
  systemctl reload nginx
fi

echo "Deployment completed."
echo "Health check: https://${DOMAIN}/healthz"
