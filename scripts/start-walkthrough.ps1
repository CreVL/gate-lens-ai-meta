param([ValidateRange(1024,65535)][int]$Port = 9010)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$simulator = Join-Path $repo 'apps\simulator'
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw 'Install Node.js 20+ and add node to PATH.' }
$nodeExe = $node.Source
if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'Install Node.js 20 or newer for local photo OCR, then restart the terminal.' }
$env:PATH = (Split-Path -Parent $nodeExe) + [IO.Path]::PathSeparator + $env:PATH
$go = Get-Command go -ErrorAction SilentlyContinue
if ($go) { $goExe = $go.Source } else { $goExe = 'C:\Program Files\Go\bin\go.exe' }
if (-not (Test-Path -LiteralPath $goExe)) { throw 'Install Go 1.24 or newer, then restart the terminal.' }
$vendor = Join-Path $simulator 'public\vendor\three.module.js'
if (-not (Test-Path -LiteralPath $vendor) -or -not (Test-Path (Join-Path $simulator 'node_modules\tesseract.js\package.json'))) {
    $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if ($pnpm) { $pnpmExe = $pnpm.Source } else {
        throw 'Install pnpm and add it to PATH.'
    }
    if (-not (Test-Path -LiteralPath $pnpmExe)) { throw 'Install Node.js and pnpm, then run this script again.' }
    Push-Location $simulator
    try {
        & $pnpmExe install --frozen-lockfile --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        & $pnpmExe run prepare-assets
        if ($LASTEXITCODE -ne 0) { throw 'Asset preparation failed.' }
    } finally { Pop-Location }
}
Push-Location (Join-Path $repo 'services\access-demo')
try {
    & $goExe run -buildvcs=false . -port $Port -web (Join-Path $simulator 'public')
    if ($LASTEXITCODE -ne 0) { throw "Demo service exited with code $LASTEXITCODE" }
} finally { Pop-Location }
