param(
  [switch]$SkipVet = $false
)

$ErrorActionPreference = 'Stop'

$skills = @(
  'agent-browser',
  'summarize',
  'self-improving-agent',
  'ontology',
  'proactive-agent',
  'humanizer',
  'nano-banana-pro',
  'auto-updater',
  'api-gateway',
  'gog',
  'openai-whisper',
  'find-skills'
) | Select-Object -Unique

Write-Host 'Installing skill-vetter...' -ForegroundColor Cyan
npx clawhub@latest install skill-vetter

foreach ($skill in $skills) {
  Write-Host "Installing $skill ..." -ForegroundColor Cyan
  npx clawhub@latest install $skill

  if (-not $SkipVet) {
    Write-Host "Vetting $skill ..." -ForegroundColor Yellow
    clawhub vet $skill
  }
}

Write-Host 'All base senate skills installed.' -ForegroundColor Green
