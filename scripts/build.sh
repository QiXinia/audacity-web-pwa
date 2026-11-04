#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NODE_ENV="${NODE_ENV:-production}"

# Standard self-contained Vite output for static hosting and GitHub Pages.
# Public assets, generated PWA files, Worklets and optional WASM glue are all
# copied into dist so the directory can be published without post-processing.
rm -rf "$ROOT/dist"
npx vite build --outDir "$ROOT/dist" --emptyOutDir

echo "Build complete: dist/"
