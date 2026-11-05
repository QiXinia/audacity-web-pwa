#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NODE_ENV="${NODE_ENV:-production}"
# GitHub Pages publishes this repository under /audacity-web-pwa/. Other hosts
# can override the base explicitly, but the default build must work publicly.
export VITE_APP_BASE="${VITE_APP_BASE:-/audacity-web-pwa/}"

# Standard self-contained Vite output for static hosting and GitHub Pages.
# Public assets, generated PWA files, Worklets and optional WASM glue are all
# copied into dist so the directory can be published without post-processing.
rm -rf "$ROOT/dist"
npx vite build --outDir "$ROOT/dist" --emptyOutDir

# GitHub Pages serves 404.html for unknown paths. A copy of the built app
# shell allows direct /editor/:id links to bootstrap React before SW control.
cp "$ROOT/dist/index.html" "$ROOT/dist/404.html"
node "$ROOT/scripts/verify-dist.mjs"

echo "Build complete: dist/"
