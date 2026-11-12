#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/tmp"
g++ -std=c++17 -O2 "$ROOT/scripts/filter-curve-oracle.cpp" -o "$ROOT/tmp/filter-curve-oracle"
"$ROOT/tmp/filter-curve-oracle" "$ROOT/tmp/filterCurveOracle.fixture.bin"
cmp "$ROOT/tmp/filterCurveOracle.fixture.bin" "$ROOT/src/lib/filterCurveOracle.fixture.bin"
npm --prefix "$ROOT" test -- --run src/lib/filterCurveEffect.oracle.test.ts
