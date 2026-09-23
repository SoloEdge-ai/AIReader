param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') {
  throw 'Installer acceptance must run on a disposable GitHub Actions Windows runner.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$programDir = Join-Path $repoRoot '.local/installer-acceptance/AIReader'
if (Test-Path -LiteralPath $programDir) { throw 'Installer test target already exists.' }
$exe = Join-Path $programDir 'AIReader.exe'
$markerDir = Join-Path $env:LOCALAPPDATA 'AIReader'
$marker = Join-Path $markerDir ('installer-ci-' + [guid]::NewGuid().ToString('N') + '.txt')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'AIReader.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AIReader.lnk'

function Run-Setup {
  $process = Start-Process -FilePath $Installer -ArgumentList @('/S', '/currentuser', "/D=$programDir") -PassThru -Wait -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Installer returned $($process.ExitCode)" }
}

function Installed-Entry {
  @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' |
    ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |
    Where-Object { $_.DisplayName -like 'AIReader*' })
}

New-Item -ItemType Directory -Path $markerDir -Force | Out-Null
Set-Content -LiteralPath $marker -Value 'keep-data-on-update-and-uninstall' -Encoding ascii
try {
  Run-Setup
  if (-not (Test-Path -LiteralPath $exe)) { throw 'Installed AIReader.exe was not found.' }
  $entry = @(Installed-Entry)
  if ($entry.Count -ne 1 -or $entry[0].DisplayVersion -ne $ExpectedVersion) {
    throw 'Installer did not register the expected version.'
  }
  if (-not (Test-Path -LiteralPath $startMenu) -or -not (Test-Path -LiteralPath $desktop)) {
    throw 'Installer did not create Start Menu and desktop shortcuts.'
  }

  Run-Setup
  $entry = @(Installed-Entry)
  if ($entry.Count -ne 1 -or $entry[0].DisplayVersion -ne $ExpectedVersion) {
    throw 'Repair/update changed the registration unexpectedly.'
  }
  if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne 'keep-data-on-update-and-uninstall') {
    throw 'Repair/update removed user data.'
  }

  Set-ItemProperty -LiteralPath $entry[0].PSPath -Name DisplayVersion -Value '999.0.0'
  try {
    $blocked = Start-Process -FilePath $Installer -ArgumentList @('/S', '/currentuser', "/D=$programDir") -PassThru -Wait -WindowStyle Hidden
    if ($blocked.ExitCode -ne 3) { throw 'Installer accepted a downgrade.' }
  } finally {
    Set-ItemProperty -LiteralPath $entry[0].PSPath -Name DisplayVersion -Value $ExpectedVersion
  }
  node scripts/desktop-smoke.mjs $exe
  if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke test failed.' }

  $uninstallString = [string]$entry[0].QuietUninstallString
  if ($uninstallString -notmatch '^"([^"]+)"') { throw 'Uninstall command is unavailable.' }
  $uninstaller = $Matches[1]
  $process = Start-Process -FilePath $uninstaller -ArgumentList @('/S', '/currentuser') -PassThru -Wait -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Uninstaller returned $($process.ExitCode)" }
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (-not (Test-Path -LiteralPath $exe) -and @(Installed-Entry).Count -eq 0) { break }
    Start-Sleep -Seconds 1
  }
  if (Test-Path -LiteralPath $exe) { throw 'Uninstall left program files behind.' }
  if (@(Installed-Entry).Count -ne 0) { throw 'Uninstall left its registration behind.' }
  if ((Test-Path -LiteralPath $startMenu) -or (Test-Path -LiteralPath $desktop)) {
    throw 'Uninstall left its shortcuts behind.'
  }
  if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne 'keep-data-on-update-and-uninstall') {
    throw 'Uninstall removed user data.'
  }
  Write-Output 'Install, update/repair, app launch, uninstall, and data retention passed.'
} finally {
  if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker }
}
