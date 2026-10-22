<#
.SYNOPSIS
    准备 v2 桌面版的内嵌引擎：opencode.exe + opencode2api 代理。

.DESCRIPTION
    这两个东西加起来约 190 MB，不适合入库，所以从源码跑之前用本脚本准备。
    幂等：已存在的步骤会跳过。

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

Step "1/4 准备 opencode 引擎（$OpenCodeVersion）"
if (Test-Path $exe) {
    Write-Host "    已存在：$exe（$([math]::Round((Get-Item $exe).Length/1MB,1)) MB）"
} else {
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    $pkgRoot = Join-Path $env:APPDATA 'npm\node_modules\opencode-ai'
    if (-not (Test-Path (Join-Path $pkgRoot 'bin\opencode.exe'))) {
        Write-Host '    安装 opencode-ai（npm 11 可能跳过 postinstall，这不影响二进制落盘）'
        & npm install -g "opencode-ai@$OpenCodeVersion"
    }
    $src = Join-Path $pkgRoot 'bin\opencode.exe'
    if (-not (Test-Path $src)) { throw "未找到 $src，请手动下载 opencode.exe 放到 $binDir" }
    Copy-Item $src $exe -Force
    Write-Host "    已复制 → $exe（$([math]::Round((Get-Item $exe).Length/1MB,1)) MB）"
}

Step '2/4 检查 opencode 可用'
& $exe --version

Step "3/4 准备 opencode2api 代理"
if (Test-Path (Join-Path $proxyDir 'index.js')) {
    Write-Host "    已存在：$proxyDir"
} else {
    & git clone --depth 1 $ProxyRepo $proxyDir
}
Push-Location $proxyDir
try {
    if (-not (Test-Path 'node_modules/express')) {
        Write-Host '    安装代理依赖'
        & npm install --omit=dev
    }
    if (-not (Test-Path 'config.json')) {
        Copy-Item 'config.json.example' 'config.json'
        Write-Host '    已生成 config.json（如需改端口请自行编辑）'
    }
} finally { Pop-Location }

Step '4/4 完成'
Write-Host @"
    引擎：$exe
    代理：$proxyDir
    启动应用：cd desktop; npm start
"@ -ForegroundColor Green
