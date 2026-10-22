<#
.SYNOPSIS
    Prepares the embedded engine for the v2 desktop app: opencode.exe + the opencode2api proxy.

.DESCRIPTION
    Together these are about 190 MB, which does not belong in the repository, so run this script before running from source.
    Idempotent: steps whose output already exists are skipped.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\setup-backend.ps1
#>
[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$OpenCodeVersion = '1.19.0',
    [string]$ProxyRepo = 'https://github.com/TiaraBasori/opencode2api.git'
)

$ErrorActionPreference = 'Stop'
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

$binDir   = Join-Path $Root 'bin'
$proxyDir = Join-Path $Root 'opencode2api'
$exe      = Join-Path $binDir 'opencode.exe'

Step "1/4 Preparing the opencode engine ($OpenCodeVersion)"
if (Test-Path $exe) {
    Write-Host "    already present: $exe ($([math]::Round((Get-Item $exe).Length/1MB,1)) MB)"
} else {
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    $pkgRoot = Join-Path $env:APPDATA 'npm\node_modules\opencode-ai'
    if (-not (Test-Path (Join-Path $pkgRoot 'bin\opencode.exe'))) {
        Write-Host '    installing opencode-ai (npm 11 may skip postinstall; the binary still lands on disk)'
        & npm install -g "opencode-ai@$OpenCodeVersion"
    }
    $src = Join-Path $pkgRoot 'bin\opencode.exe'
    if (-not (Test-Path $src)) { throw "not found: $src - download opencode.exe manually and put it in $binDir" }
    Copy-Item $src $exe -Force
    Write-Host "    copied -> $exe ($([math]::Round((Get-Item $exe).Length/1MB,1)) MB)"
}

Step '2/4 Checking that opencode works'
& $exe --version

Step "3/4 Preparing the opencode2api proxy"
if (Test-Path (Join-Path $proxyDir 'index.js')) {
    Write-Host "    already present: $proxyDir"
} else {
    & git clone --depth 1 $ProxyRepo $proxyDir
}
Push-Location $proxyDir
try {
    if (-not (Test-Path 'node_modules/express')) {
        Write-Host '    installing proxy dependencies'
        & npm install --omit=dev
    }
    if (-not (Test-Path 'config.json')) {
        Copy-Item 'config.json.example' 'config.json'
        Write-Host '    generated config.json (edit it yourself if you need a different port)'
    }
} finally { Pop-Location }

Step '4/4 Done'
Write-Host @"
    engine: $exe
    proxy:  $proxyDir
    start the app: cd desktop; npm start
"@ -ForegroundColor Green
