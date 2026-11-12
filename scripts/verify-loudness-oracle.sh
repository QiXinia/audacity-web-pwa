#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/tmp"
g++ -std=c++17 -O2 "$ROOT/scripts/loudness-oracle.cpp" -o "$ROOT/tmp/loudness-oracle"
"$ROOT/tmp/loudness-oracle" "$ROOT/tmp/loudnessOracle.fixture.bin"
cmp "$ROOT/tmp/loudnessOracle.fixture.bin" "$ROOT/src/lib/loudnessOracle.fixture.bin"
npm --prefix "$ROOT" test -- --run src/lib/loudnessEffect.oracle.test.ts
