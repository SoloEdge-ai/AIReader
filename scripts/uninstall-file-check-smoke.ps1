param([string]$Makensis)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
if (-not $Makensis) {
  $cacheRoot = if ($env:ELECTRON_BUILDER_CACHE) { $env:ELECTRON_BUILDER_CACHE } else { Join-Path $env:LOCALAPPDATA 'electron-builder/Cache' }
  $Makensis = Get-ChildItem -LiteralPath $cacheRoot -Recurse -Filter 'makensis.exe' |
    Where-Object { $_.FullName -match 'nsis-' } |
    Sort-Object FullName | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Makensis -or -not (Test-Path -LiteralPath $Makensis)) { throw 'NSIS compiler is unavailable; build the installer first.' }
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$probeRoot = Join-Path $tempRoot ('aireader-uninstall-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $probeRoot | Out-Null
$fixtureDir = Join-Path $probeRoot 'installed'
$mainFile = Join-Path $fixtureDir 'AIReader.exe'
$companion = Join-Path $fixtureDir 'companion.txt'
$completion = Join-Path $probeRoot 'completion.txt'
$uninstaller = Join-Path $fixtureDir 'Uninstall.exe'
$fixtureScript = Join-Path $repoRoot 'tests/fixtures/uninstall-file-check.nsi'
$guardInclude = Join-Path $repoRoot 'build/uninstall-file-check.nsh'
$heldFile = $null
$running = $null

function Build-Probe([bool]$Guard) {
  $arguments = @('/INPUTCHARSET', 'UTF8', "/DPROBE_ROOT=$probeRoot", "/DGUARD_INCLUDE=$guardInclude")
  if ($Guard) { $arguments += '/DUSE_GUARD' }
  & $Makensis @arguments $fixtureScript | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'NSIS probe compilation failed.' }
}
function Reset-Probe {
  if (Test-Path -LiteralPath $completion) { Remove-Item -LiteralPath $completion }
  $generator = Start-Process -FilePath (Join-Path $probeRoot 'generator.exe') -PassThru -Wait -WindowStyle Hidden
  if ($generator.ExitCode -ne 0) { throw 'Fixture generation failed.' }
}
function Start-Probe {
  Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$fixtureDir" -PassThru -WindowStyle Hidden
}
function Finish-Probe([Diagnostics.Process]$Process) {
  if (-not $Process.WaitForExit(20000)) { throw 'Isolated uninstaller timed out.' }
  return $Process.ExitCode
}
try {
  Build-Probe $false
  Reset-Probe
  $heldFile = [IO.File]::Open($mainFile, 'Open', 'Read', 'Read')
  $running = Start-Probe
  $baselineExit = Finish-Probe $running
  if ($baselineExit -ne 0 -or -not (Test-Path -LiteralPath $mainFile) -or -not (Test-Path -LiteralPath $completion)) {
    throw 'Baseline did not reproduce silent success with a retained executable.'
  }
  $heldFile.Dispose(); $heldFile = $null
  Write-Output 'Red signal reproduced: default NSIS cleanup reports success but retains the locked executable.'

  Build-Probe $true
  Reset-Probe
  $heldFile = [IO.File]::Open($mainFile, 'Open', 'Read', 'Read')
  $running = Start-Probe
  $blockedExit = Finish-Probe $running
  if ($blockedExit -ne 6 -or -not (Test-Path -LiteralPath $mainFile) -or
      -not (Test-Path -LiteralPath $companion) -or (Test-Path -LiteralPath $completion)) {
    throw 'Persistent lock was not rejected before the remaining files and registration stage.'
  }
  $heldFile.Dispose(); $heldFile = $null

  Reset-Probe
  $heldFile = [IO.File]::Open($mainFile, 'Open', 'Read', 'Read')
  $running = Start-Probe
  Start-Sleep -Milliseconds 1000
  if ($running.HasExited) { throw 'Guard did not wait for the transient lock.' }
  $heldFile.Dispose(); $heldFile = $null
  $releasedExit = Finish-Probe $running
  if ($releasedExit -ne 0 -or (Test-Path -LiteralPath $mainFile) -or -not (Test-Path -LiteralPath $completion)) {
    throw 'Transient file lock did not recover through bounded retry.'
  }
  Write-Output 'NSIS removal guard passed: persistent lock returns 6 without advancing; transient lock retries and succeeds.'
} finally {
  if ($heldFile) { $heldFile.Dispose() }
  if ($running -and -not $running.HasExited) { $running.Kill(); $running.WaitForExit() }
  $resolvedProbe = (Resolve-Path -LiteralPath $probeRoot).Path
  if (-not $resolvedProbe.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolvedProbe) -notmatch '^aireader-uninstall-test-[a-f0-9]{32}$') {
    throw 'Refusing to clean an unexpected fixture path.'
  }
  Remove-Item -LiteralPath $resolvedProbe -Recurse -Force
}
