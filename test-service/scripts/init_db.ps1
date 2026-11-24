# Apply sql/schema.sql via XAMPP mysql (Windows)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$sql = Join-Path $Root "sql\schema.sql"
$mysql = "C:\xampp\mysql\bin\mysql.exe"
if (-not (Test-Path $mysql)) {
    Write-Error "mysql.exe not found at $mysql"
}
Get-Content -Raw $sql | & $mysql -uroot
Write-Host "test_db schema applied."
