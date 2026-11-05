<#
  package-sfx-windows.ps1 — build INSIGHT's Windows deliverable as a single
  7-Zip self-extracting installer (INSIGHT_<ver>_x64-setup.exe).

  WHY NOT TAURI'S NSIS/MSI: both of Tauri's Windows bundlers choke on INSIGHT's
  ~5 GB bundled-model payload — WiX/MSI can't CAB it, and 32-bit makensis can't
  emit an installer past ~2 GB. A 7-Zip SFX has no such limit. See WINDOWS_BUILD.md
  and the memory note insight-windows-installer-size-limits.

  PREREQUISITE: run scripts/prepare-bundle-windows.ps1 first — it stages
  src-tauri/resources/{standalone,assets,bin} (the whole models, server, binaries).

  This script then: compiles the Tauri app without a bundle, assembles a portable
  app folder (INSIGHT.exe + those resource trees as siblings, which is exactly what
  app.path().resource_dir() resolves to), and wraps it in a self-extractor.

  The resulting .exe is a GUI self-extractor (7-Zip's 7z.sfx): the user picks a
  folder and it extracts the full offline app there. A bundled
  "Create INSIGHT shortcuts.cmd" makes Start-Menu/Desktop shortcuts on demand.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProgressPreference     = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Res    = Join-Path $Root "src-tauri\resources"
$Target = Join-Path $Root "src-tauri\target\release"
$Ver    = (Get-Content (Join-Path $Root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version

foreach ($d in @("standalone", "assets", "bin")) {
  if (-not (Test-Path (Join-Path $Res $d))) {
    throw "missing src-tauri\resources\$d — run scripts/prepare-bundle-windows.ps1 first."
  }
}

# ---- 1/3  Compile the app (no installer bundle) ----------------------------
Write-Host "==> 1/3  Building the Tauri app (no bundle)"
npm run tauri:build -- --no-bundle
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

$AppExe = Join-Path $Target "app.exe"
if (-not (Test-Path $AppExe)) { throw "expected build output not found: $AppExe" }

# ---- 2/3  Assemble the portable app folder ---------------------------------
# Layout mirrors a Tauri install: INSIGHT.exe with assets/standalone/bin beside
# it, so app.path().resource_dir() (the exe's own directory) + "assets" etc. match
# src-tauri/src/lib.rs. Shipped WHOLE — no split/reassembly (the SFX has no limit).
Write-Host "==> 2/3  Assembling the portable app folder"
$Stage  = Join-Path $Root "src-tauri\target\sfx"
$AppDir = Join-Path $Stage "INSIGHT"
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

Copy-Item -Force $AppExe (Join-Path $AppDir "INSIGHT.exe")
# Any sidecar DLLs Tauri emitted next to the exe (e.g. WebView2Loader.dll).
Get-ChildItem -Path $Target -Filter *.dll -File -ErrorAction SilentlyContinue |
  ForEach-Object { Copy-Item -Force $_.FullName $AppDir }
foreach ($d in @("standalone", "assets", "bin")) {
  Copy-Item -Recurse -Force (Join-Path $Res $d) (Join-Path $AppDir $d)
}

# One-click shortcut creator the operator can run after extracting.
$shortcutCmd = @'
@echo off
rem Creates Start Menu + Desktop shortcuts to INSIGHT in the extracted folder.
set "TARGET=%~dp0INSIGHT.exe"
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; foreach($f in @([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('Desktop'))){ $s=$w.CreateShortcut((Join-Path $f 'INSIGHT.lnk')); $s.TargetPath=$env:TARGET; $s.WorkingDirectory=(Split-Path $env:TARGET); $s.Save() }"
echo Created Start Menu and Desktop shortcuts for INSIGHT.
pause
'@
Set-Content -Path (Join-Path $AppDir "Create INSIGHT shortcuts.cmd") -Value $shortcutCmd -Encoding ASCII

# ---- 3/3  Build the self-extracting .exe -----------------------------------
Write-Host "==> 3/3  Building the 7-Zip self-extractor"
$7zExe = Join-Path $env:ProgramFiles "7-Zip\7z.exe"
$7zSfx = Join-Path $env:ProgramFiles "7-Zip\7z.sfx"   # GUI "extract to folder" module
if (-not (Test-Path $7zExe)) { throw "7z.exe not found at $7zExe (7-Zip is preinstalled on windows-latest)." }
if (-not (Test-Path $7zSfx)) { throw "7z.sfx not found at $7zSfx (part of the 7-Zip install)." }

$payload = Join-Path $Stage "payload.7z"
# -mx=1: light/fast. The models are already quantized (incompressible), so a
# higher level just burns time. -mmt=on uses all runner cores.
& $7zExe a -t7z -mx=1 -mmt=on -- $payload $AppDir | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $payload)) { throw "7z payload creation failed" }

$OutDir = Join-Path $Target "sfx"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Setup = Join-Path $OutDir ("INSIGHT_{0}_x64-setup.exe" -f $Ver)
if (Test-Path $Setup) { Remove-Item -Force $Setup }

# An SFX is just the module followed by the archive bytes.
$fsOut = [System.IO.File]::Create($Setup)
try {
  foreach ($part in @($7zSfx, $payload)) {
    $fsIn = [System.IO.File]::OpenRead($part)
    try { $fsIn.CopyTo($fsOut) } finally { $fsIn.Dispose() }
  }
} finally { $fsOut.Dispose() }

if (-not (Test-Path $Setup)) { throw "SFX creation failed" }
Write-Host ("==> Built {0} ({1:N0} MB)" -f $Setup, ((Get-Item $Setup).Length / 1MB))
