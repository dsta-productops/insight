# Building the Windows (.exe) version

INSIGHT's desktop app is a Tauri app. A **Windows build must be compiled on
Windows** (it uses WebView2 and the MSVC toolchain) — it cannot be
cross-compiled from macOS. This repo carries everything needed to produce it; the
only step that requires a Windows machine is the actual compile, which the
included GitHub Actions workflow runs for you on a hosted runner.

**The deliverable is a 7-Zip self-extracting `.exe`, not a Tauri NSIS/MSI
installer.** Both of Tauri's Windows bundlers choke on INSIGHT's ~5 GB
bundled-model payload (WiX/MSI can't CAB it; 32-bit `makensis` can't emit an
installer past ~2 GB). A 7-Zip SFX has no such limit. See "Why a 7-Zip SFX" below.

## What's in place

| Piece | File | What it does |
|---|---|---|
| Cross-platform audio | `lib/transcribe/providers.ts` | `afconvert` on macOS → bundled **ffmpeg** on Windows/Linux |
| Cross-platform launcher | `src-tauri/src/lib.rs` | `.exe` binary names on Windows, passes `FFMPEG_BIN`, hides console windows |
| Resource bundler | `scripts/prepare-bundle-windows.ps1` | Stages the Next server, models (whole), and binaries into `src-tauri/resources/` |
| SFX packager | `scripts/package-sfx-windows.ps1` | Builds the app unbundled, assembles a portable folder, wraps it in a 7-Zip self-extractor |
| CI build | `.github/workflows/windows-build.yml` | Runs both scripts on `windows-latest`, uploads the `.exe` |

## How to produce the installer

### Option A — GitHub Actions (recommended; no Windows machine needed)

1. Push this repo to GitHub (see the data-safety note below).
2. Actions tab → **Windows build** → **Run workflow**.
3. Download the `insight-windows-installer` artifact — the self-extracting
   `INSIGHT_<ver>_x64-setup.exe`.

Pushing a `v*` tag (e.g. `git tag v0.1.0 && git push --tags`) also builds and
attaches the installer to a GitHub Release.

### Option B — on a Windows machine directly

Requires: Node 22+, Rust (stable, MSVC), cmake, git, 7-Zip, and WebView2 (present
on Win 10/11). Then:

```powershell
npm ci
./scripts/prepare-bundle-windows.ps1
./scripts/package-sfx-windows.ps1
# Output: src-tauri\target\release\sfx\INSIGHT_<ver>_x64-setup.exe
```

Running the `.exe` prompts for a destination folder and extracts the full offline
app (`INSIGHT.exe` + `assets/` + `standalone/` + `bin/`) there. To make shortcuts,
run the bundled **"Create INSIGHT shortcuts.cmd"** once.

## Why a 7-Zip SFX (not NSIS/MSI)

makensis (32-bit) hits three walls on a ~5 GB payload, in order: a single file
>~2 GB fails to mmap; a single file >~512 MB fails with "Internal compiler error
#12345: error mmapping file … is out of range"; and even with every file split
small, the cumulative output can't exceed ~2 GB. WiX/MSI's `light.exe` can't pack
the payload into a CAB either. The 7-Zip SFX sidesteps all of this — it's just a
self-extractor with no size limit. Trade-off: no built-in Add/Remove-Programs
uninstaller; shortcuts are made via the bundled `.cmd`. A richer installer
(e.g. Inno Setup, which does handle multi-GB) is a possible future upgrade.

## Decisions baked in (change if needed)

- **GPU backend = Vulkan** (`-LlamaFlavor vulkan`, the default). Vulkan gives the
  widest coverage — NVIDIA, AMD, and Intel — with no CUDA toolkit dependency.
  The published spec targets an 8 GB-VRAM NVIDIA RTX; on such a box the **CUDA**
  build is faster. To ship CUDA instead, run the workflow with the `cuda` flavor
  (or `./scripts/prepare-bundle-windows.ps1 -LlamaFlavor cuda`). See
  `insight-system-requirements` / `insight-local-8b-coach-limits` in memory.
- **Whisper is built from source (CPU)** — no Vulkan/CUDA SDK needed; fine for
  the short live audio chunks.
- **ffmpeg** is the BtbN static GPL build. Only used to normalise *uploaded*
  audio to 16 kHz mono WAV; live capture is already 16 kHz WAV from the browser.
- **Models (~5 GB) are bundled whole**, matching the macOS build. CI caches them
  so only the first run pays the Hugging Face download; the `.exe` is ~5 GB. No
  splitting (the SFX has no file-size limit).
- **SFX payload is lightly compressed** (`7z -mx=1`). The models are already
  quantized/incompressible, so this is for speed, not ratio.
- **Portable layout**: the SFX extracts `INSIGHT.exe` with `assets/`, `standalone/`
  and `bin/` beside it — exactly what `app.path().resource_dir()` (the exe's own
  directory) resolves to, so `src-tauri/src/lib.rs` finds the models unchanged.
- **WebView2** is assumed present (Win 10/11 ship it). The SFX does not bundle the
  WebView2 bootstrapper; if you must support a stripped Win 10, add it separately.

## Data-safety note before pushing to GitHub

`data/` holds real interview data. `.gitignore` now excludes all of it
**except** the non-sensitive build seeds the bundler needs (`data/coach-corpus/`,
`data/glossary.json`). Confirm `git status` shows no sessions/transcripts/
suggestions/summaries/audio before the first push.

## Not yet verified (needs a real Windows run + hardware)

- **The produced `.exe` has not been run on Windows.** CI confirms it *builds*
  (the app compiles and the SFX is produced); extraction, first launch, model
  loading, and the shortcut `.cmd` still need a test on a real Windows box. The
  key runtime assumption is that `resource_dir()` resolves to the exe's folder so
  the sibling `assets/standalone/bin` are found — verify on first launch.
- **Coach performance** can only be validated on real Windows + a real GPU (a
  physical RTX box or a cloud GPU instance). A Windows-on-ARM VM on a Mac has no
  NVIDIA GPU and cannot measure it.
- **Code signing** is not set up; the unsigned `.exe` triggers SmartScreen.
  Separate follow-up.
