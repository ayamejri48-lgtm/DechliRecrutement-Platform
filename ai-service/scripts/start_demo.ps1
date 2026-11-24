# Jury demo launcher — rules + hybrid-v3 (no Ollama required)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$venvPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Error "Missing .venv — run: python -m venv .venv ; .\.venv\Scripts\pip install -r requirements.txt"
}

# Stable jury defaults
$env:AI_EXTRACT_BACKEND = "rules"
$env:AI_SEMANTIC_BACKEND = "tfidf"
if (-not $env:AI_INTERNAL_API_KEY) {
    $env:AI_INTERNAL_API_KEY = "dechli-jury-demo-key-2026"
}

Write-Host "AI-Service jury demo"
Write-Host "  extract = rules | semantic = tfidf | match = hybrid-v3"
Write-Host "  key     = $($env:AI_INTERNAL_API_KEY)"
Write-Host "  docs    = http://127.0.0.1:8000/docs"
Write-Host "  health  = http://127.0.0.1:8000/health"
Write-Host ""

& $venvPy -m uvicorn app.main:app --host 127.0.0.1 --port 8000
