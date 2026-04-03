param(
  [Parameter(Position = 0)]
  [string]$Action = "help",
  [Parameter(Position = 1)]
  [string]$Target = "control"
)

$ErrorActionPreference = "Stop"

$validActions = @("help", "ps", "up", "down", "logs", "test")
$validTargets = @("control", "infra", "ai", "ai-heavy", "backend", "web", "edge", "routing", "monitoring", "telegram", "anythingllm", "tunnel", "all", "release")

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

function Invoke-NpmScript {
  param(
    [string]$WorkingDir,
    [string]$Script
  )
  $prevPythonUtf8 = $env:PYTHONUTF8
  $prevPythonIo = $env:PYTHONIOENCODING
  $env:PYTHONUTF8 = "1"
  $env:PYTHONIOENCODING = "utf-8"
  Push-Location $WorkingDir
  try {
    Write-Host "> npm run $Script ($WorkingDir)" -ForegroundColor DarkGray
    & npm run $Script
    if ($LASTEXITCODE -ne 0) {
      throw "npm run $Script failed in $WorkingDir"
    }
  }
  finally {
    Pop-Location
    $env:PYTHONUTF8 = $prevPythonUtf8
    $env:PYTHONIOENCODING = $prevPythonIo
  }
}

function Invoke-PythonScript {
  param(
    [string]$WorkingDir,
    [string]$ScriptPath
  )
  $prevPythonUtf8 = $env:PYTHONUTF8
  $prevPythonIo = $env:PYTHONIOENCODING
  $env:PYTHONUTF8 = "1"
  $env:PYTHONIOENCODING = "utf-8"
  Push-Location $WorkingDir
  try {
    Write-Host "> python $ScriptPath ($WorkingDir)" -ForegroundColor DarkGray
    & python $ScriptPath
    if ($LASTEXITCODE -ne 0) {
      throw "python $ScriptPath failed in $WorkingDir"
    }
  }
  finally {
    Pop-Location
    $env:PYTHONUTF8 = $prevPythonUtf8
    $env:PYTHONIOENCODING = $prevPythonIo
  }
}

function Resolve-ServiceList {
  param([string]$Name)
  switch ($Name) {
    "infra" { return @("redis", "postgres", "qdrant", "ollama", "ollama-init") }
    "ai" { return @("redis", "postgres", "qdrant", "ollama", "ollama-init", "ai-subservice") }
    "ai-heavy" { return @("redis", "postgres", "qdrant", "ollama", "ollama-init", "ai-subservice-heavy") }
    "backend" { return @("redis", "postgres", "qdrant", "ollama", "ollama-init", "ai-subservice", "backend") }
    "web" { return @("redis", "postgres", "qdrant", "ollama", "ollama-init", "ai-subservice", "backend", "web") }
    "control" { return @("redis", "postgres", "qdrant", "ollama", "ollama-init", "ai-subservice", "backend", "web") }
    "release" { return @("redis", "postgres", "qdrant", "ollama", "ollama-init", "ai-subservice", "backend", "web") }
    "routing" { return @("claw-router") }
    "monitoring" { return @("prometheus", "grafana") }
    "telegram" { return @("telegram-bot") }
    "anythingllm" { return @("anythingllm") }
    "tunnel" { return @("cloudflared") }
    "edge" { return @() }
    "all" {
      return @(
        "redis", "postgres", "qdrant", "ollama", "ollama-init",
        "ai-subservice", "ai-subservice-heavy", "backend", "web", "claw-router", "prometheus",
        "grafana", "telegram-bot", "anythingllm"
      )
    }
    default { throw "No service mapping for target: $Name" }
  }
}

function Invoke-ModuleTests {
  param([string]$Name)

  switch ($Name) {
    "control" {
      Invoke-NpmScript -WorkingDir "apps/backend" -Script "test:redaction"
      Invoke-NpmScript -WorkingDir "apps/backend" -Script "test:resilience"
      Invoke-NpmScript -WorkingDir "apps/web" -Script "build"
      return
    }
    "backend" {
      Invoke-NpmScript -WorkingDir "apps/backend" -Script "test:redaction"
      Invoke-NpmScript -WorkingDir "apps/backend" -Script "test:resilience"
      return
    }
    "web" {
      Invoke-NpmScript -WorkingDir "apps/web" -Script "build"
      return
    }
    "ai" {
      Invoke-NpmScript -WorkingDir "apps/ai-subservice" -Script "test:stage2"
      Invoke-NpmScript -WorkingDir "apps/ai-subservice" -Script "test:baseline"
      return
    }
    "ai-heavy" {
      Invoke-NpmScript -WorkingDir "apps/ai-subservice" -Script "test:stage2"
      Invoke-NpmScript -WorkingDir "apps/ai-subservice" -Script "test:baseline"
      return
    }
    "edge" {
      Invoke-NpmScript -WorkingDir "apps/edge-runtime" -Script "smoke"
      return
    }
    "release" {
      Invoke-PythonScript -WorkingDir "." -ScriptPath "scripts/contracts/validate_contracts.py"
      Invoke-ModuleTests -Name "control"
      Invoke-ModuleTests -Name "ai"
      Invoke-ModuleTests -Name "edge"
      return
    }
    default {
      throw "No test mapping for target: $Name"
    }
  }
}

switch ($Action) {
  "help" {
    Write-Host "Usage: powershell -File scripts/modules/module.ps1 <action> <target>"
    Write-Host "Actions: $($validActions -join ', ')"
    Write-Host "Targets: $($validTargets -join ', ')"
    Write-Host "Examples:"
    Write-Host "  ./scripts/modules/module.ps1 up control"
    Write-Host "  ./scripts/modules/module.ps1 up routing"
    Write-Host "  ./scripts/modules/module.ps1 logs ai"
    Write-Host "  ./scripts/modules/module.ps1 test release"
    break
  }
  "ps" {
    Invoke-Compose -ComposeArgs @("ps")
    break
  }
  "up" {
    switch ($Target) {
      "all" {
        Invoke-Compose -ComposeArgs @("--profile", "routing", "--profile", "monitoring", "--profile", "telegram", "--profile", "anythingllm", "up", "-d")
      }
      "routing" {
        Invoke-Compose -ComposeArgs @("--profile", "routing", "up", "-d", "claw-router")
      }
      "ai-heavy" {
        Invoke-Compose -ComposeArgs @("--profile", "ai-heavy", "up", "-d", "redis", "postgres", "qdrant", "ollama", "ollama-init", "ai-subservice-heavy")
      }
      "monitoring" {
        Invoke-Compose -ComposeArgs @("--profile", "monitoring", "up", "-d", "prometheus", "grafana")
      }
      "telegram" {
        Invoke-Compose -ComposeArgs @("--profile", "telegram", "up", "-d", "telegram-bot")
      }
      "anythingllm" {
        Invoke-Compose -ComposeArgs @("--profile", "anythingllm", "up", "-d", "anythingllm")
      }
      "tunnel" {
        Invoke-Compose -ComposeArgs @("--profile", "tunnel", "up", "-d", "cloudflared")
      }
      default {
        $services = Resolve-ServiceList -Name $Target
        Invoke-Compose -ComposeArgs (@("up", "-d") + $services)
      }
    }
    break
  }
  "down" {
    switch ($Target) {
      "all" {
        Invoke-Compose -ComposeArgs @("down")
      }
      "routing" {
        Invoke-Compose -ComposeArgs @("stop", "claw-router")
      }
      "ai-heavy" {
        Invoke-Compose -ComposeArgs @("stop", "ai-subservice-heavy")
      }
      "monitoring" {
        Invoke-Compose -ComposeArgs @("stop", "prometheus", "grafana")
      }
      "telegram" {
        Invoke-Compose -ComposeArgs @("stop", "telegram-bot")
      }
      "anythingllm" {
        Invoke-Compose -ComposeArgs @("stop", "anythingllm")
      }
      "tunnel" {
        Invoke-Compose -ComposeArgs @("stop", "cloudflared")
      }
      default {
        $services = Resolve-ServiceList -Name $Target
        if ($services.Count -gt 0) {
          Invoke-Compose -ComposeArgs (@("stop") + $services)
        }
      }
    }
    break
  }
  "logs" {
    $services = Resolve-ServiceList -Name $Target
    if ($services.Count -eq 0) {
      throw "No compose logs for target '$Target'."
    }
    Invoke-Compose -ComposeArgs (@("logs", "-f") + $services)
    break
  }
  "test" {
    Invoke-ModuleTests -Name $Target
    break
  }
}
