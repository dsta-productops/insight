# Building the Windows (.exe) version

INSIGHT's desktop app is a Tauri app. A **Windows build must be compiled on
Windows** (it uses WebView2, the MSVC toolchain, and NSIS/WiX for installers) —
it cannot be cross-compiled from macOS. This repo carries everything needed to
produce it; the only step that requires a Windows machine is the actual compile,
which the included GitHub Actions workflow runs for you on a hosted runner.

## What's in place

| Piece | File | What it does |
|---|---|---|
| Cross-platform audio | `lib/transcribe/providers.ts` | `afconvert` on macOS → bundled **ffmpeg** on Windows/Linux |
| Cross-platform launcher | `src-tauri/src/lib.rs` | `.exe` binary names on Windows, passes `FFMPEG_BIN`, hides console windows |
| Windows bundler | `scripts/prepare-bundle-windows.ps1` | Windows counterpart to `prepare-bundle.sh` |
| CI build | `.github/workflows/windows-build.yml` | Runs the bundler + `tauri build` on `windows-latest`, uploads the installer |

## How to produce the installer

### Option A — GitHub Actions (recommended; no Windows machine needed)

1. Push this repo to GitHub (see the data-safety note below).
2. Actions tab → **Windows build** → **Run workflow**.
3. Download the `insight-windows-installers` artifact — it contains the NSIS
   `.exe` installer. (The WiX/MSI target is disabled: its `light.exe` linker
   can't pack the ~5 GB bundled-model payload. NSIS handles it and is Tauri's
   recommended Windows installer.)

Pushing a `v*` tag (e.g. `git tag v0.1.0 && git push --tags`) also builds and
attaches the installers to a GitHub Release.

### Option B — on a Windows machine directly

Requires: Node 22+, Rust (stable, MSVC), cmake, git, and WebView2 (present on
Win 10/11). Then:

```powershell
npm ci
./scripts/prepare-bundle-windows.ps1
npm run tauri:build -- --bundles nsis
# Output: src-tauri\target\release\bundle\nsis\*.exe
```

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
- **Models (~5 GB) are bundled**, matching the macOS build. CI caches them so
  only the first run pays the Hugging Face download; the installer is ~5 GB.
- **The 4.7 GB Llama GGUF is split into <2 GB parts** (`...gguf.000`, `.001`, …)
  because `makensis` can't embed a single file larger than ~2 GB. The bundler
  does the split; the NSIS **postinstall hook** (`src-tauri/installer-hooks.nsh`,
  wired via `bundle.windows.nsis.installerHooks`) concatenates them back into the
  one file `lib.rs` expects and deletes the parts. macOS bundles the whole file
  (DMG has no such limit). Consequence: during install the parts and the
  assembled file briefly coexist, so **~10 GB of free disk is needed at install
  time** (steady-state footprint is ~5 GB).
- **NSIS compression = zlib** (`compression: "zlib"`). The GGUF is already
  quantized/incompressible, so the point is speed, not ratio: zlib is fast and
  low-memory (LZMA would add tens of minutes for ~0 savings). `"none"` is NOT
  usable — makensis's uncompressed path mmaps each file in 32 MB windows and
  mishandles the final partial window, failing on any bundled file whose size
  isn't an exact 32 MB multiple (e.g. the whisper model).
- **Installer target is NSIS only** (`--bundles nsis`); the WiX/MSI `light.exe`
  linker can't pack the multi-GB payload into a CAB.
- **Per-user install** (`installMode: currentUser`) — installs under
  `%LOCALAPPDATA%`, so the postinstall reassembly needs no administrator rights.

## Data-safety note before pushing to GitHub

`data/` holds real interview data. `.gitignore` now excludes all of it
**except** the non-sensitive build seeds the bundler needs (`data/coach-corpus/`,
`data/glossary.json`). Confirm `git status` shows no sessions/transcripts/
suggestions/summaries/audio before the first push.

## Not yet verified (needs a real run + hardware)

- **This harness has not been run** — the `.exe` has never been built. The macOS
  `cargo check` passes, but the `#[cfg(windows)]` code and the PowerShell script
  are first validated by the CI run. Expect 1–2 iterations on binary-asset names
  (llama.cpp / ffmpeg release layouts drift).
- **Coach performance** can only be validated on real Windows + a real GPU (a
  physical RTX box or a cloud GPU instance). A Windows-on-ARM VM on a Mac has no
  NVIDIA GPU and cannot measure it.
- **Code signing / notarization** is not set up; unsigned installers trigger
  SmartScreen. Separate follow-up.
