param(
  [Parameter(Position = 0)]
  [string]$Action = "help",
  [Parameter(Position = 1)]
  [string]$Target = "web"
)

$ErrorActionPreference = "Stop"

$validActions = @("help", "ps", "up", "down", "logs", "dev", "test")
$validTargets = @("web", "backend", "ai", "ai-heavy", "edge", "desktop", "all")

if ($Action -notin $validActions) {
  throw "Unsupported action: $Action. Valid: $($validActions -join ', ')"
}

if ($Target -notin $validTargets) {
  throw "Unsupported target: $Target. Valid: $($validTargets -join ', ')"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\\..")
Set-Location $repoRoot

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  Write-Host "> docker compose $($ComposeArgs -join ' ')" -ForegroundColor DarkGray
  & docker compose @ComposeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed: $($ComposeArgs -join ' ')"
  }
}

function Invoke-AppNpmScript {
  param(
    [string]$AppName,
    [string]$ScriptName
  )

  $prevPythonUtf8 = $env:PYTHONUTF8
  $prevPythonIo = $env:PYTHONIOENCODING
  $env:PYTHONUTF8 = "1"
  $env:PYTHONIOENCODING = "utf-8"

  try {
    Write-Host "> npm --prefix apps/$AppName run $ScriptName" -ForegroundColor DarkGray
    & npm --prefix "apps/$AppName" run $ScriptName
    if ($LASTEXITCODE -ne 0) {
      throw "apps/$AppName npm script failed: $ScriptName"
    }
  }
  finally {
    $env:PYTHONUTF8 = $prevPythonUtf8
    $env:PYTHONIOENCODING = $prevPythonIo
  }
}

function Ensure-NodeDeps {
  param(
    [string]$ProjectPath,
    [string]$PrimaryBinName
  )

  $projectAbs = Join-Path $repoRoot $ProjectPath
  $lockPath = Join-Path $projectAbs "package-lock.json"
  $nodeModulesPath = Join-Path $projectAbs "node_modules"
  $binBase = Join-Path $projectAbs "node_modules/.bin/$PrimaryBinName"
  $binCmd = "$binBase.cmd"
  $binNoExt = $binBase

  $needsInstall = $false

  if (!(Test-Path $binCmd) -and !(Test-Path $binNoExt)) {
    $needsInstall = $true
  } elseif ((Test-Path $lockPath) -and (Test-Path $nodeModulesPath)) {
    $lockTs = (Get-Item $lockPath).LastWriteTimeUtc
    $nmTs = (Get-Item $nodeModulesPath).LastWriteTimeUtc
    if ($lockTs -gt $nmTs) {
      $needsInstall = $true
    }
  }

  if (-not $needsInstall) {
    Write-Host ">>> [$ProjectPath] Node dependencies already ready, skip install." -ForegroundColor DarkGray
    return
  }

  Write-Host ">>> [$ProjectPath] dependencies missing/stale, installing..." -ForegroundColor Yellow
  if (Test-Path $lockPath) {
    & npm --prefix $ProjectPath ci
    if ($LASTEXITCODE -ne 0) {
      Write-Host ">>> [$ProjectPath] npm ci failed, fallback to npm install" -ForegroundColor Yellow
      & npm --prefix $ProjectPath install
      if ($LASTEXITCODE -ne 0) {
        throw "Dependency install failed for $ProjectPath"
      }
    }
  } else {
    & npm --prefix $ProjectPath install
    if ($LASTEXITCODE -ne 0) {
      throw "Dependency install failed for $ProjectPath"
    }
  }
}

function Invoke-AppAction {
  param(
    [string]$ActionName,
    [string]$TargetName
  )

  switch ($ActionName) {
    "up" {
      switch ($TargetName) {
        "web" { Invoke-AppNpmScript -AppName "web" -ScriptName "up"; return }
        "backend" { Invoke-AppNpmScript -AppName "backend" -ScriptName "up"; return }
        "ai" { Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "up"; return }
        "ai-heavy" { Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "up:heavy"; return }
        "edge" { throw "edge target has no compose up. Use: apps dev edge or apps test edge." }
        "desktop" { throw "desktop target uses local tauri dev/build. Use: apps dev desktop or apps test desktop." }
        "all" {
          Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "up"
          Invoke-AppNpmScript -AppName "backend" -ScriptName "up"
          Invoke-AppNpmScript -AppName "web" -ScriptName "up"
          return
        }
      }
    }
    "down" {
      switch ($TargetName) {
        "web" { Invoke-AppNpmScript -AppName "web" -ScriptName "down"; return }
        "backend" { Invoke-AppNpmScript -AppName "backend" -ScriptName "down"; return }
        "ai" { Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "down"; return }
        "ai-heavy" { Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "down:heavy"; return }
        "edge" { throw "edge target has no compose down." }
        "desktop" { throw "desktop target has no compose down." }
        "all" {
          Invoke-AppNpmScript -AppName "web" -ScriptName "down"
          Invoke-AppNpmScript -AppName "backend" -ScriptName "down"
          Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "down"
          Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "down:heavy"
          return
        }
      }
    }
    "logs" {
      switch ($TargetName) {
        "web" { Invoke-AppNpmScript -AppName "web" -ScriptName "logs"; return }
        "backend" { Invoke-AppNpmScript -AppName "backend" -ScriptName "logs"; return }
        "ai" { Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "logs"; return }
        "ai-heavy" { Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "logs:heavy"; return }
        "edge" { throw "edge target has no compose logs." }
        "desktop" { throw "desktop target has no compose logs. Use tauri terminal output." }
        "all" {
          Invoke-Compose -ComposeArgs @("logs", "-f", "web", "backend", "ai-subservice")
          return
        }
      }
    }
    "dev" {
      switch ($TargetName) {
        "web" {
          Ensure-NodeDeps -ProjectPath "web" -PrimaryBinName "next"
          Invoke-AppNpmScript -AppName "web" -ScriptName "dev"
          return
        }
        "backend" {
          Ensure-NodeDeps -ProjectPath "backend" -PrimaryBinName "nest"
          Invoke-AppNpmScript -AppName "backend" -ScriptName "dev"
          return
        }
        "ai" { Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "dev"; return }
        "ai-heavy" { throw "ai-heavy has no local dev mode. Use up ai-heavy." }
        "edge" { Invoke-AppNpmScript -AppName "edge-runtime" -ScriptName "run:agent"; return }
        "desktop" { Invoke-AppNpmScript -AppName "desktop-client" -ScriptName "tauri:dev"; return }
        "all" { throw "all + dev is not supported (long-running concurrent processes)." }
      }
    }
    "test" {
      switch ($TargetName) {
        "web" {
          Ensure-NodeDeps -ProjectPath "web" -PrimaryBinName "next"
          Invoke-AppNpmScript -AppName "web" -ScriptName "build"
          return
        }
        "backend" {
          Ensure-NodeDeps -ProjectPath "backend" -PrimaryBinName "nest"
          Invoke-AppNpmScript -AppName "backend" -ScriptName "test:redaction"
          Invoke-AppNpmScript -AppName "backend" -ScriptName "test:resilience"
          return
        }
        "ai" {
          Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "test:stage2"
          Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "test:baseline"
          return
        }
        "ai-heavy" {
          Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "test:stage2"
          Invoke-AppNpmScript -AppName "ai-subservice" -ScriptName "test:baseline"
          return
        }
        "edge" { Invoke-AppNpmScript -AppName "edge-runtime" -ScriptName "smoke"; return }
        "desktop" { Invoke-AppNpmScript -AppName "desktop-client" -ScriptName "tauri:build"; return }
        "all" {
          Invoke-AppAction -ActionName "test" -TargetName "backend"
          Invoke-AppAction -ActionName "test" -TargetName "ai"
          Invoke-AppAction -ActionName "test" -TargetName "edge"
          Invoke-AppAction -ActionName "test" -TargetName "desktop"
          Invoke-AppAction -ActionName "test" -TargetName "web"
          return
        }
      }
    }
  }
}

switch ($Action) {
  "help" {
    Write-Host "Usage: powershell -File scripts/apps/apps.ps1 <action> <target>"
    Write-Host "Actions: $($validActions -join ', ')"
    Write-Host "Targets: $($validTargets -join ', ')"
    Write-Host "Examples:"
    Write-Host "  ./scripts/apps/apps.ps1 up web"
    Write-Host "  ./scripts/apps/apps.ps1 up all"
    Write-Host "  ./scripts/apps/apps.ps1 dev ai"
    Write-Host "  ./scripts/apps/apps.ps1 test all"
    break
  }
  "ps" {
    Invoke-Compose -ComposeArgs @("ps")
    break
  }
  default {
    Invoke-AppAction -ActionName $Action -TargetName $Target
    break
  }
}
