param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or
    -not $env:GITHUB_WORKSPACE -or
    [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE) -ne [IO.Path]::GetFullPath($repoRoot)) {
  throw 'Installer acceptance requires the clean Windows GitHub Actions workspace.'
}

$defaultProgramDir = Join-Path $env:LOCALAPPDATA 'Programs/AIReader'
$customProgramDir = Join-Path $repoRoot '.local/installer-acceptance/AIReader'
$dataDir = Join-Path $env:LOCALAPPDATA 'AIReader'
$marker = Join-Path $dataDir 'installer-ci-retain.txt'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'AIReader.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AIReader.lnk'

function Installed-Entry {
  @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |
    Where-Object { $_.DisplayName -eq 'AIReader' -or $_.DisplayName -like 'AIReader *' })
}

function Machine-Entry {
  @(Get-ChildItem 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |
    Where-Object { $_.DisplayName -eq 'AIReader' -or $_.DisplayName -like 'AIReader *' })
}

function Invoke-Setup([string[]]$Arguments, [int]$ExpectedExit = 0) {
  $process = Start-Process -FilePath $Installer -ArgumentList $Arguments -PassThru -Wait -WindowStyle Hidden
  if ($process.ExitCode -ne $ExpectedExit) {
    throw "Installer returned $($process.ExitCode); expected $ExpectedExit for $($Arguments -join ' ')"
  }
}

function Assert-Installed([string]$ExpectedDir) {
  $entry = @(Installed-Entry)
  if ($entry.Count -ne 1 -or $entry[0].DisplayVersion -ne $ExpectedVersion) {
    $found = ($entry | ForEach-Object { "$($_.DisplayName) [$($_.DisplayVersion)]" }) -join ', '
    throw "Installer did not register exactly one current-user installation with version $ExpectedVersion; found $($entry.Count): $found"
  }
  $uninstallString = [string]$entry[0].QuietUninstallString
  if ($uninstallString -notmatch '^"([^\"]+)"' -or
      [IO.Path]::GetFullPath((Split-Path -Parent $Matches[1])) -ne
      [IO.Path]::GetFullPath($ExpectedDir)) {
    throw 'Installer did not register the expected installation directory.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $ExpectedDir 'AIReader.exe'))) {
    throw 'Installed AIReader.exe was not found.'
  }
  if (-not (Test-Path -LiteralPath $startMenu) -or -not (Test-Path -LiteralPath $desktop)) {
    throw 'Installer did not create Start Menu and desktop shortcuts.'
  }
  if (@(Machine-Entry).Count -ne 0) { throw 'Installer created a machine-wide registration.' }
  return $entry[0]
}

function Assert-Data {
  if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne 'keep-data-on-update-and-uninstall') {
    throw 'Installer removed user data.'
  }
}

function Invoke-Uninstall([object]$Entry, [string]$ExpectedDir) {
  $uninstallString = [string]$Entry.QuietUninstallString
  if ($uninstallString -notmatch '^"([^\"]+)"') { throw 'Uninstall command is unavailable.' }
  $uninstaller = $Matches[1]
  if ([IO.Path]::GetFullPath((Split-Path -Parent $uninstaller)) -ne
      [IO.Path]::GetFullPath($ExpectedDir)) {
    throw 'Registered uninstaller is outside the tested installation directory.'
  }
  $process = Start-Process -FilePath $uninstaller -ArgumentList @('/S', '/currentuser') -PassThru -Wait -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Uninstaller returned $($process.ExitCode)" }
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (-not (Test-Path -LiteralPath (Join-Path $ExpectedDir 'AIReader.exe')) -and
        @(Installed-Entry).Count -eq 0) { break }
    Start-Sleep -Seconds 1
  }
  if (Test-Path -LiteralPath (Join-Path $ExpectedDir 'AIReader.exe')) { throw 'Uninstall left program files behind.' }
  if (@(Installed-Entry).Count -ne 0) { throw 'Uninstall left its registration behind.' }
  if ((Test-Path -LiteralPath $startMenu) -or (Test-Path -LiteralPath $desktop)) {
    throw 'Uninstall left its shortcuts behind.'
  }
  Assert-Data
}

# A CI environment variable alone is not evidence of an isolated machine.
# Refuse to run if any installation, shortcut or profile already exists.
if (@(Installed-Entry).Count -ne 0 -or @(Machine-Entry).Count -ne 0 -or
    (Test-Path -LiteralPath $defaultProgramDir) -or
    (Test-Path -LiteralPath $customProgramDir) -or
    (Test-Path -LiteralPath $dataDir) -or
    (Test-Path -LiteralPath $startMenu) -or
    (Test-Path -LiteralPath $desktop)) {
  throw 'Installer acceptance requires a clean runner; an AIReader installation or profile already exists.'
}

Invoke-Setup @('/S', '/allusers') 4
if (@(Installed-Entry).Count -ne 0 -or @(Machine-Entry).Count -ne 0) {
  throw '/allusers modified the registry.'
}

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
Set-Content -LiteralPath $marker -Value 'keep-data-on-update-and-uninstall' -Encoding ascii
try {
  # No /D: verify the real default path and the app's default data location.
  Invoke-Setup @('/S', '/currentuser')
  $entry = Assert-Installed $defaultProgramDir
  $env:AIREADER_SMOKE_USE_DEFAULT = '1'
  $env:AIREADER_CREATE_NOTE = '1'
  node scripts/desktop-smoke.mjs (Join-Path $defaultProgramDir 'AIReader.exe')
  if ($LASTEXITCODE -ne 0) { throw 'Installed application could not save a book and note.' }
  Remove-Item Env:AIREADER_CREATE_NOTE

  Invoke-Setup @('/S', '/currentuser')
  $entry = Assert-Installed $defaultProgramDir
  Assert-Data
  $env:AIREADER_EXPECT_EXISTING = '1'
  node scripts/desktop-smoke.mjs (Join-Path $defaultProgramDir 'AIReader.exe')
  if ($LASTEXITCODE -ne 0) { throw 'Installed application could not read its existing book and note.' }
  Remove-Item Env:AIREADER_EXPECT_EXISTING

  Set-ItemProperty -LiteralPath $entry.PSPath -Name DisplayVersion -Value '999.0.0'
  try {
    Invoke-Setup @('/S', '/currentuser') 3
  } finally {
    Set-ItemProperty -LiteralPath $entry.PSPath -Name DisplayVersion -Value $ExpectedVersion
  }
  Invoke-Uninstall $entry $defaultProgramDir

  # A custom first install must be upgraded at its registered path, without /D.
  Invoke-Setup @('/S', '/currentuser', "/D=$customProgramDir")
  $entry = Assert-Installed $customProgramDir
  Invoke-Setup @('/S', '/currentuser')
  $entry = Assert-Installed $customProgramDir
  Invoke-Uninstall $entry $customProgramDir
  Assert-Data
  Write-Output 'Default install, book/note continuity, custom-path update, downgrade guard and uninstall passed.'
} finally {
  Remove-Item Env:AIREADER_SMOKE_USE_DEFAULT -ErrorAction SilentlyContinue
  Remove-Item Env:AIREADER_CREATE_NOTE -ErrorAction SilentlyContinue
  Remove-Item Env:AIREADER_EXPECT_EXISTING -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker }
}
