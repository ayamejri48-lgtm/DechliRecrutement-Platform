# Test-Service launcher (Phase 0)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$venvPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Error "Missing .venv — run: python -m venv .venv ; .\.venv\Scripts\pip install -r requirements.txt"
}

if (-not (Test-Path (Join-Path $Root ".env"))) {
    Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
    Write-Host "Created .env from .env.example"
}

Write-Host "Test-Service Phase 0"
Write-Host "  health = http://127.0.0.1:8005/health"
Write-Host "  docs   = http://127.0.0.1:8005/docs"
Write-Host ""

& $venvPy -m uvicorn app.main:app --host 127.0.0.1 --port 8005 --reload
