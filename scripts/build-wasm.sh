#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack is required. Install it with: cargo install wasm-pack --locked" >&2
  exit 1
fi

rustup target add wasm32-unknown-unknown
wasm-pack build src/wasm/audio_processor \
  --target web \
  --release \
  --out-dir ../../../public/wasm \
  --out-name audio_processor

# wasm-pack generates an ignore-all file for package registries. These two
# artifacts are intentionally committed so the web fallback is never the only
# deployable implementation.
rm -f public/wasm/.gitignore public/wasm/package.json

echo "WASM build complete: public/wasm/audio_processor.js + audio_processor_bg.wasm"
