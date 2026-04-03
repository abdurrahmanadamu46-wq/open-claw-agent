@echo off
setlocal

set ROOT_DIR=%~dp0..
cd /d "%ROOT_DIR%"

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
  )
)

echo [server-start] starting lobster full stack
docker compose -f docker-compose.full.yml up -d --build
echo [server-start] done
