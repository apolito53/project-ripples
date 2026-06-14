param(
  [int]$Port = 5183
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

if (-not (Test-Path "node_modules")) {
  npm.cmd install
}

npm.cmd run dev -- --port $Port --strictPort
