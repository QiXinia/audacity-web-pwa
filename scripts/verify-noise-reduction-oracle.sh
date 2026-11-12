#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/tmp"
g++ -std=c++17 -O2 "$ROOT/scripts/noise-reduction-oracle.cpp" -o "$ROOT/tmp/noise-reduction-oracle"
"$ROOT/tmp/noise-reduction-oracle" "$ROOT/tmp/noiseReductionOracle.fixture.bin"
cmp "$ROOT/tmp/noiseReductionOracle.fixture.bin" "$ROOT/src/lib/noiseReductionOracle.fixture.bin"
npm --prefix "$ROOT" test -- --run src/lib/noiseReductionEffect.oracle.test.ts
