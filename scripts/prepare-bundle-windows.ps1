<#
  prepare-bundle-windows.ps1 — Windows (x64) counterpart to prepare-bundle.sh.

  Stages the three resource trees Tauri bundles (see tauri.conf.json
  `bundle.resources` and src-tauri/src/lib.rs):
    standalone/  — the Next `output: 'standalone'` server (run by bundled node.exe)
    assets/      — READ-ONLY: whisper + llama models, coach corpus, seed glossary
    bin/         — node.exe, llama-server.exe (+DLLs), whisper-cli.exe, ffmpeg.exe

  Then you run `npm run tauri:build` to get INSIGHT.exe / the NSIS+MSI installers.
  Designed to run on a Windows machine OR a GitHub Actions `windows-latest` runner
  (see .github/workflows/windows-build.yml). Re-runnable; large downloads are
  cached in data/models and skipped if present.

  GPU backend: llama.cpp is pulled as the **Vulkan** Windows build — the widest
  GPU coverage (NVIDIA + AMD + Intel), no CUDA toolkit dependency. To prefer the
  CUDA build on NVIDIA boxes, set  -LlamaFlavor cuda  (see $LlamaFlavor below).
#>
[CmdletBinding()]
param(
  [string]$NodeVersion   = "v22.14.0",
  [string]$WhisperModel  = "ggml-large-v3-turbo-q5_0.bin",
  # llama.cpp Windows asset flavor to bundle: "vulkan" (default) | "cuda" | "cpu".
  [ValidateSet("vulkan", "cuda", "cpu")]
  [string]$LlamaFlavor   = "vulkan"
)

$ErrorActionPreference = "Stop"
$ProgressPreference     = "SilentlyContinue"   # faster Invoke-WebRequest downloads

$Root = Split-Path -Parent $PSScriptRoot
$Res  = Join-Path $Root "src-tauri\resources"
Set-Location $Root

$LlamaModelUrl = "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"

# Resumable-ish download with retries (HF/CDNs drop connections mid-stream).
function Get-File([string]$Url, [string]$Out) {
  $tries = 0
  while ($true) {
    try {
      Invoke-WebRequest -Uri $Url -OutFile $Out -UseBasicParsing -MaximumRedirection 10
      return
    } catch {
      $tries++
      if ($tries -ge 8) { throw "download failed after $tries attempts: $Url`n$_" }
      Write-Host "    ...download error; retrying ($tries)"
      Start-Sleep -Seconds 3
    }
  }
}

function Expand-Zip([string]$Zip, [string]$Dest) {
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  Expand-Archive -Path $Zip -DestinationPath $Dest -Force
}

# ---- 1/4  Next standalone server -------------------------------------------
Write-Host "==> 1/4  Building the Next standalone server"
npm run build
if ($LASTEXITCODE -ne 0) { throw "next build failed" }

$Standalone = Join-Path $Res "standalone"
if (Test-Path $Standalone) { Remove-Item -Recurse -Force $Standalone }
New-Item -ItemType Directory -Force -Path $Standalone | Out-Null
Copy-Item -Recurse -Force ".next\standalone\*" $Standalone
# Next does NOT copy these into standalone — the server serves them at runtime.
New-Item -ItemType Directory -Force -Path (Join-Path $Standalone ".next") | Out-Null
Copy-Item -Recurse -Force ".next\static" (Join-Path $Standalone ".next\static")
if (Test-Path "public") { Copy-Item -Recurse -Force "public" (Join-Path $Standalone "public") }
# Backfill next/dist/lib (the file tracer can omit runtime-required internals,
# which crashes server.js on boot and leaves the window blank). Same fix as macOS.
$LibDst = Join-Path $Standalone "node_modules\next\dist\lib"
New-Item -ItemType Directory -Force -Path $LibDst | Out-Null
Copy-Item -Recurse -Force "node_modules\next\dist\lib\*" $LibDst

# ---- 2/4  Read-only assets (models, coach corpus, seed glossary) -----------
Write-Host "==> 2/4  Staging read-only assets"
$Assets = Join-Path $Res "assets"
if (Test-Path $Assets) { Remove-Item -Recurse -Force $Assets }
$AssetsModels = Join-Path $Assets "models"
New-Item -ItemType Directory -Force -Path $AssetsModels | Out-Null
Copy-Item -Recurse -Force "data\coach-corpus" (Join-Path $Assets "coach-corpus")
Copy-Item -Force "data\glossary.json" (Join-Path $Assets "glossary.json")

$WhisperSrc = Join-Path "data\models" $WhisperModel
if (-not (Test-Path $WhisperSrc)) {
  Write-Host "    downloading whisper model $WhisperModel ..."
  New-Item -ItemType Directory -Force -Path "data\models" | Out-Null
  Get-File "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$WhisperModel" $WhisperSrc
}
Copy-Item -Force $WhisperSrc (Join-Path $AssetsModels $WhisperModel)

# llama GGUF (~4.9 GB) — filename must match src-tauri/src/lib.rs.
$LlamaCache = "data\models\llama-3.1-8b-instruct.gguf"
if (-not (Test-Path $LlamaCache)) {
  Write-Host "    downloading llama 3.1 8B GGUF (~4.9 GB, one time)..."
  Get-File $LlamaModelUrl $LlamaCache
}
Copy-Item -Force $LlamaCache (Join-Path $AssetsModels "llama-3.1-8b-instruct.gguf")

# ---- 3/4  Binaries ----------------------------------------------------------
Write-Host "==> 3/4  Staging binaries into resources\bin"
$Bin = Join-Path $Res "bin"
New-Item -ItemType Directory -Force -Path $Bin | Out-Null
$Tmp = Join-Path $env:TEMP ("insight-bin-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

# node.exe — official Windows build.
if (-not (Test-Path (Join-Path $Bin "node.exe"))) {
  Write-Host "    fetching Node $NodeVersion (win-x64)..."
  $NodeZip = Join-Path $Tmp "node.zip"
  Get-File "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" $NodeZip
  Expand-Zip $NodeZip (Join-Path $Tmp "node")
  Copy-Item -Force (Join-Path $Tmp "node\node-$NodeVersion-win-x64\node.exe") (Join-Path $Bin "node.exe")
}

# llama-server.exe (+ its DLLs) — GitHub release, Windows $LlamaFlavor build.
if (-not (Test-Path (Join-Path $Bin "llama-server.exe"))) {
  Write-Host "    fetching latest llama.cpp win-$LlamaFlavor-x64 release..."
  # NOTE: /releases/latest points at a nightly-tag marker release that carries
  # only nightly-tag.txt — no binaries. The real Windows builds are published as
  # prereleases (tags like b12119), which /latest excludes. So scan the recent
  # releases and take the newest that actually carries this flavor's x64 asset.
  # Asset names look like  llama-<build>-bin-win-<flavor>[-<ver>]-x64.zip  (the
  # CUDA ones embed a toolkit version, e.g. ...-cuda-13.4-x64.zip).
  $pattern = "llama-*bin-win-$LlamaFlavor*-x64.zip"
  $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30" -Headers @{ "User-Agent" = "insight-build" }
  $asset = $null
  foreach ($rel in $releases) {
    $asset = $rel.assets |
      Where-Object { $_.name -like $pattern -and $_.name -notlike "cudart-*" } |
      Sort-Object name | Select-Object -First 1
    if ($asset) { break }
  }
  if (-not $asset) { throw "no llama.cpp asset matching $pattern in the last 30 releases (asset naming may have changed)." }
  Write-Host "    using $($asset.name)"
  $LlamaZip = Join-Path $Tmp "llama.zip"
  Get-File $asset.browser_download_url $LlamaZip
  Expand-Zip $LlamaZip (Join-Path $Tmp "llama")
  # The archive lays the binary + DLLs flat (sometimes under a build\ or bin\ dir).
  $serverExe = Get-ChildItem -Recurse -Path (Join-Path $Tmp "llama") -Filter "llama-server.exe" | Select-Object -First 1
  if (-not $serverExe) { throw "llama.cpp archive layout changed — no llama-server.exe after extract." }
  Copy-Item -Force (Join-Path $serverExe.DirectoryName "*") $Bin
}

# whisper-cli.exe — build whisper.cpp statically from source (cmake + MSVC on
# the runner). CPU build: no Vulkan/CUDA SDK needed, fine for chunked live audio.
if (-not (Test-Path (Join-Path $Bin "whisper-cli.exe"))) {
  Write-Host "    building whisper.cpp (static) from source..."
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp (Join-Path $Tmp "whisper")
  cmake -S (Join-Path $Tmp "whisper") -B (Join-Path $Tmp "whisper\build") -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release | Out-Null
  cmake --build (Join-Path $Tmp "whisper\build") --config Release --target whisper-cli | Out-Null
  $wcli = Get-ChildItem -Recurse -Path (Join-Path $Tmp "whisper\build") -Filter "whisper-cli.exe" | Select-Object -First 1
  if (-not $wcli) { throw "whisper-cli.exe not found after build." }
  Copy-Item -Force $wcli.FullName (Join-Path $Bin "whisper-cli.exe")
}

# ffmpeg.exe — replaces macOS afconvert for batch-upload audio normalisation.
# BtbN static GPL build (self-contained single .exe). See lib/transcribe/providers.ts.
if (-not (Test-Path (Join-Path $Bin "ffmpeg.exe"))) {
  Write-Host "    fetching ffmpeg (win64, static)..."
  $FfZip = Join-Path $Tmp "ffmpeg.zip"
  Get-File "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" $FfZip
  Expand-Zip $FfZip (Join-Path $Tmp "ffmpeg")
  $ff = Get-ChildItem -Recurse -Path (Join-Path $Tmp "ffmpeg") -Filter "ffmpeg.exe" | Select-Object -First 1
  if (-not $ff) { throw "ffmpeg.exe not found in archive." }
  Copy-Item -Force $ff.FullName (Join-Path $Bin "ffmpeg.exe")
}

Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue

# ---- 4/4  Done --------------------------------------------------------------
Write-Host "==> 4/4  Done staging. Bundle sizes:"
Get-ChildItem $Res | ForEach-Object {
  $size = (Get-ChildItem -Recurse -File $_.FullName | Measure-Object -Property Length -Sum).Sum
  "{0,-14} {1:N0} MB" -f $_.Name, ($size / 1MB)
}
Write-Host ""
Write-Host "Next: npm run tauri:build"
Write-Host "Output: src-tauri\target\release\bundle\  (nsis\*.exe, msi\*.msi)"
