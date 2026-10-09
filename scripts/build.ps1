$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
& npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
& go test ./...
if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
$releasePath = Join-Path $projectRoot 'release'
New-Item -ItemType Directory -Force -Path $releasePath | Out-Null
& go build -trimpath -ldflags '-s -w' -o (Join-Path $releasePath 'china-chip.exe') .
if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
# Resolve the launcher by extension so this build also works when PowerShell reads
# this script under a legacy code page that cannot represent the Chinese filename.
$launcher = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'scripts') -Filter '*.cmd' | Select-Object -First 1
if (-not $launcher) { throw 'Launcher script not found.' }
Copy-Item -LiteralPath $launcher.FullName -Destination (Join-Path $releasePath 'start-classroom.cmd')
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $releasePath 'usage.md')
Write-Host "Portable application ready: $releasePath"
