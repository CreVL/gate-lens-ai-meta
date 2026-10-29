param([string]$Device = '', [string]$Avd = 'Pixel_4a_API_36')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $repo '.artifacts'
New-Item -ItemType Directory -Force $artifacts | Out-Null
function Resolve-Tool([string]$Name,[string]$Fallback) {
    $tool = Get-Command $Name -ErrorAction SilentlyContinue
    if ($tool) { return $tool.Source }
    if ($Fallback -and (Test-Path -LiteralPath $Fallback)) { return $Fallback }
    throw "Missing $Name. Install it or add it to PATH."
}
function Check-Exit([string]$Step) { if ($LASTEXITCODE -ne 0) { throw "$Step failed ($LASTEXITCODE)." } }
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$go = Resolve-Tool 'go.exe' 'C:\Program Files\Go\bin\go.exe'
$flutter = Resolve-Tool 'flutter.bat' (Join-Path $env:USERPROFILE 'fvm\default\bin\flutter.bat')
$node = Resolve-Tool 'node.exe' ''
# The Go OCR subprocess inherits this PATH, including when Node came from the fallback.
$env:PATH = (Split-Path -Parent $node) + [IO.Path]::PathSeparator + $env:PATH
if (-not (Test-Path $adb)) { throw "Android platform-tools not found at $sdk" }
if (-not (Test-Path (Join-Path $repo 'apps\simulator\public\vendor\three.module.js')) -or -not (Test-Path (Join-Path $repo 'apps\simulator\node_modules\tesseract.js\package.json'))) {
    $pnpm = Resolve-Tool 'pnpm.cmd' ''
    Push-Location (Join-Path $repo 'apps\simulator')
    try { & $pnpm install --frozen-lockfile --ignore-scripts; Check-Exit 'Dependencies'; & $pnpm run prepare-assets; Check-Exit 'Assets' } finally { Pop-Location }
}
Write-Output 'Building the linked Flutter preview...'
Push-Location (Join-Path $repo 'apps\companion')
try { & $flutter --no-version-check build apk --debug --dart-define=GATELENS_AUTOSTART=true; Check-Exit 'Flutter build' } finally { Pop-Location }

if (-not $Device) {
    $emulators = @(& $adb devices | ForEach-Object { if ($_ -match '^(emulator-\d+)\s+device$') { $Matches[1] } })
    if ($emulators.Count -gt 1) { throw 'More than one emulator is running. Pass -Device emulator-XXXX.' }
    if ($emulators.Count -eq 1) { $Device = $emulators[0] } else {
        Write-Output "Starting $Avd without a window..."
        Start-Process -FilePath (Join-Path $sdk 'emulator\emulator.exe') -ArgumentList @('-avd',$Avd,'-no-window','-no-audio','-no-boot-anim','-no-snapshot-save','-gpu','swiftshader_indirect') -WindowStyle Hidden | Out-Null
        $deadline = (Get-Date).AddSeconds(90)
        while (-not $Device -and (Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 1
            $emulators = @(& $adb devices | ForEach-Object { if ($_ -match '^(emulator-\d+)\s+device$') { $Matches[1] } })
            if ($emulators.Count -eq 1) { $Device = $emulators[0] }
        }
    }
}
if (-not $Device) { throw 'No emulator became available. Start one in Android Studio and retry.' }
$deadline = (Get-Date).AddSeconds(90)
while ((& $adb -s $Device shell getprop sys.boot_completed 2>$null) -notmatch '1') {
    if ((Get-Date) -gt $deadline) { throw 'Android boot timed out.' }
    Start-Sleep -Seconds 1
}

# Only replace a recorded GateLens demo process, never an unrelated listener.
$pidFile = Join-Path $artifacts 'walkthrough-server.pid'
$listener = Get-NetTCPConnection -LocalPort 9010 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    if (-not (Test-Path $pidFile)) { throw 'Port 9010 is occupied by an untracked process.' }
    $recorded = [int](Get-Content $pidFile)
    $process = Get-Process -Id $recorded -ErrorAction SilentlyContinue
    $allowed = @((Join-Path $artifacts 'access-demo.exe'),(Join-Path $artifacts 'access-demo-meta.exe'))
    if (-not $process -or $listener.OwningProcess -ne $recorded -or $process.Path -notin $allowed) { throw 'Port 9010 does not belong to the recorded GateLens server.' }
    Stop-Process -Id $recorded
    $process.WaitForExit(5000) | Out-Null
}
$server = Join-Path $artifacts 'access-demo-meta.exe'
Push-Location (Join-Path $repo 'services\access-demo')
try { & $go build -buildvcs=false -o $server .; Check-Exit 'Go build' } finally { Pop-Location }
$process = Start-Process -FilePath $server -ArgumentList @('-port','9010','-web',(Join-Path $repo 'apps\simulator\public')) -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $artifacts 'walkthrough-server.log') -RedirectStandardError (Join-Path $artifacts 'walkthrough-server-error.log') -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id
& $adb -s $Device reverse tcp:9010 tcp:9010; Check-Exit 'ADB reverse'
& $adb -s $Device forward tcp:9000 tcp:9000; Check-Exit 'ADB forward'
& $adb -s $Device install -r (Join-Path $repo 'apps\companion\build\app\outputs\flutter-apk\app-debug.apk'); Check-Exit 'APK install'
& $adb -s $Device shell am force-stop dev.gatelens.gatelens_companion
& $adb -s $Device shell am start -n dev.gatelens.gatelens_companion/.MainActivity; Check-Exit 'App launch'
$ready = $false
for ($attempt=0; $attempt -lt 25; $attempt++) {
    try {
        $content = Invoke-RestMethod 'http://127.0.0.1:9010/display/content' -Method Post -ContentType 'application/json' -Body '{"afterRevision":null}' -TimeoutSec 2
        if ($content.payload) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'Meta preview did not become ready. Inspect the Flutter app and .artifacts server logs.' }
Write-Output 'READY: Open http://127.0.0.1:9010/glasses in Chrome yourself.'
Write-Output 'Enable Meta Ray-Ban Display Simulator for this page, then click Walk in checkpoint.'
Write-Output "Backend PID: $($process.Id). Android device: $Device. No browser window was opened."
