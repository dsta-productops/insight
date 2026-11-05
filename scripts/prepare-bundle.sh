#!/usr/bin/env bash
#
# prepare-bundle.sh — stage everything the standalone Tauri app bundles, then
# you run `npm run tauri:build`. macOS (Apple Silicon) target for now; Windows
# is a later pass (swap the binary sources + afconvert->ffmpeg).
#
# It assembles three resource trees under src-tauri/resources/ (see
# tauri.conf.json `bundle.resources` and src-tauri/src/lib.rs which reads them):
#   standalone/  — the Next `output: 'standalone'` server (run by bundled node)
#   assets/      — READ-ONLY: whisper + llama models, coach corpus, seed glossary
#   bin/         — node, llama-server, whisper-cli (self-contained binaries)
#
# Re-run any time; existing large downloads are skipped.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/src-tauri/resources"
cd "$ROOT"

# Resumable, retrying download for flaky CDNs (Hugging Face drops connections
# mid-stream: HTTP/2 "CANCEL" and curl(18) "transfer closed"). Forces HTTP/1.1,
# and loops with `-C -` so every restart resumes the partial file instead of
# starting over. --retry-all-errors makes curl itself retry the (18) case.
dl() {  # dl <url> <out>
  local tries=0
  until curl -L --fail --http1.1 --retry 10 --retry-delay 3 \
             --retry-connrefused --retry-all-errors -C - -o "$2" "$1"; do
    tries=$((tries + 1))
    if [ "$tries" -ge 30 ]; then
      echo "!! download kept dropping after $tries attempts: $1" >&2
      return 1
    fi
    echo "    …connection dropped; resuming (attempt $tries)"
    sleep 3
  done
}

# ---- tunables (bump as needed) ----------------------------------------------
NODE_VERSION="v22.14.0"                 # LTS; bundled Node runtime
LLAMA_GGUF_URL="https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
WHISPER_MODEL="ggml-large-v3-turbo-q5_0.bin"   # must already exist in data/models/

echo "==> 1/4  Building the Next standalone server"
npm run build
rm -rf "$RES/standalone"
mkdir -p "$RES/standalone"
cp -R .next/standalone/. "$RES/standalone/"
# Next does NOT copy these into standalone — the server serves them at runtime.
mkdir -p "$RES/standalone/.next"
cp -R .next/static "$RES/standalone/.next/static"
[ -d public ] && cp -R public "$RES/standalone/public" || true
# Next's file tracer (output: 'standalone') can OMIT runtime-required internals
# under next/dist/lib — notably lib/metadata/get-metadata-route.js — which
# crashes server.js on boot with "Cannot find module '../../../lib/metadata/
# get-metadata-route'" and leaves the desktop window BLANK. Backfill the whole
# dir from the installed package so the server actually starts. (2026-07-30)
cp -R node_modules/next/dist/lib/. "$RES/standalone/node_modules/next/dist/lib/"

# Belt-and-suspenders: nft tries to pull data/models into standalone (dynamic
# read in lib/transcribe/providers.ts). next.config.mjs excludes it and that
# works on macOS, but prune defensively so the ~5 GB models can never get
# bundled twice (also in assets/). Mirrors the Windows bundler. (2026-11-05)
rm -rf "$RES/standalone/data"

echo "==> 2/4  Staging read-only assets (models, coach corpus, seed glossary)"
rm -rf "$RES/assets"
mkdir -p "$RES/assets/models"
cp -R data/coach-corpus "$RES/assets/coach-corpus"
cp data/glossary.json "$RES/assets/glossary.json"
# whisper model (already fetched into data/models during dev)
if [ ! -f "data/models/$WHISPER_MODEL" ]; then
  echo "!! Missing data/models/$WHISPER_MODEL — download it from huggingface.co/ggerganov/whisper.cpp" >&2
  exit 1
fi
cp "data/models/$WHISPER_MODEL" "$RES/assets/models/$WHISPER_MODEL"
# llama GGUF (~4.9 GB) — must match the filename in src-tauri/src/lib.rs
LLAMA_DST="$RES/assets/models/llama-3.1-8b-instruct.gguf"
if [ -f "data/models/llama-3.1-8b-instruct.gguf" ]; then
  cp "data/models/llama-3.1-8b-instruct.gguf" "$LLAMA_DST"
else
  echo "    downloading llama 3.1 8B GGUF (~4.9 GB, one time; re-run to resume if it drops)…"
  dl "$LLAMA_GGUF_URL" "$LLAMA_DST"
  cp "$LLAMA_DST" "data/models/llama-3.1-8b-instruct.gguf"   # cache for re-runs
fi

echo "==> 3/4  Staging binaries into resources/bin"
mkdir -p "$RES/bin"

# node — official build is self-contained/relocatable
if [ ! -x "$RES/bin/node" ]; then
  echo "    fetching Node $NODE_VERSION (darwin-arm64)…"
  TMP="$(mktemp -d)"
  dl "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-arm64.tar.gz" "$TMP/node.tar.gz"
  tar -xzf "$TMP/node.tar.gz" -C "$TMP"
  cp "$TMP/node-$NODE_VERSION-darwin-arm64/bin/node" "$RES/bin/node"
  rm -rf "$TMP"
fi

# llama-server — GitHub release ships llama-server + its @loader_path dylibs;
# copy them all so the dylibs (+ *.metal) travel with it.
# NOTE (2026-07-30): llama.cpp now ships macOS as a `.tar.gz` (was `.zip`), and
# the archive contains a single flat `llama-bXXXXX/` dir (binary + dylibs at the
# top level — no nested `bin/`). Match .tar.gz and copy that dir's contents.
if [ ! -x "$RES/bin/llama-server" ]; then
  echo "    fetching latest llama.cpp macos-arm64 release…"
  ASSET_URL="$(curl -s https://api.github.com/repos/ggml-org/llama.cpp/releases/latest \
    | grep -o 'https://[^"]*bin-macos-arm64\.tar\.gz' | head -1)"
  if [ -z "$ASSET_URL" ]; then
    echo "!! Could not find a macos-arm64 llama.cpp release asset (looked for *bin-macos-arm64.tar.gz)." >&2
    echo "!! Their asset naming may have changed again; grab llama-server manually into $RES/bin/ (with its dylibs)." >&2
    exit 1
  fi
  TMP="$(mktemp -d)"
  dl "$ASSET_URL" "$TMP/llama.tar.gz"
  tar -xzf "$TMP/llama.tar.gz" -C "$TMP"
  # The extracted dir is llama-bXXXXX/ with the binary + dylibs flat inside it.
  EXDIR="$(find "$TMP" -maxdepth 1 -type d -name 'llama-b*' | head -1)"
  if [ -z "$EXDIR" ] || [ ! -f "$EXDIR/llama-server" ]; then
    echo "!! llama.cpp archive layout changed — no llama-server found after extract." >&2
    exit 1
  fi
  cp -R "$EXDIR/." "$RES/bin/"
  rm -rf "$TMP"
fi
chmod +x "$RES/bin/llama-server" 2>/dev/null || true

# whisper-cli — build whisper.cpp statically so it's self-contained (no brew dylibs).
if [ ! -x "$RES/bin/whisper-cli" ]; then
  echo "    building whisper.cpp (static) from source…"
  command -v cmake >/dev/null || { echo "!! cmake required (brew install cmake)"; exit 1; }
  TMP="$(mktemp -d)"
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$TMP/whisper"
  cmake -S "$TMP/whisper" -B "$TMP/whisper/build" -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build "$TMP/whisper/build" --config Release -j --target whisper-cli >/dev/null
  cp "$TMP/whisper/build/bin/whisper-cli" "$RES/bin/whisper-cli"
  rm -rf "$TMP"
fi
chmod +x "$RES/bin/whisper-cli"

echo "==> 4/4  Done staging. Bundle sizes:"
du -sh "$RES"/* 2>/dev/null || true
echo ""
echo "Next: source \"\$HOME/.cargo/env\" && npm run tauri:build"
echo "Output: src-tauri/target/release/bundle/  (INSIGHT.app / .dmg)"
