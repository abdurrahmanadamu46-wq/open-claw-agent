#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
WEB_DIR="${ROOT_DIR}/web"
TARGET_FILE="${WEB_DIR}/src/api/generated/schema.d.ts"
TMP_DIR="$(mktemp -d)"
TMP_FILE="${TMP_DIR}/schema.d.ts"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

if [[ -f "${TARGET_FILE}" ]]; then
  cp "${TARGET_FILE}" "${TMP_FILE}"
else
  touch "${TMP_FILE}"
fi

pushd "${BACKEND_DIR}" >/dev/null
npm run generate:openapi
popd >/dev/null

pushd "${WEB_DIR}" >/dev/null
npm run generate-api:file
popd >/dev/null

if ! cmp -s "${TMP_FILE}" "${TARGET_FILE}"; then
  echo "OpenAPI generated types are stale: ${TARGET_FILE}"
  echo "Run: cd backend && npm run generate:openapi"
  echo "Then: cd web && npm run generate-api:file"
  exit 1
fi

echo "OpenAPI generated types are up to date."
