#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/tmp"
g++ -std=c++17 -O2 "$ROOT/scripts/classic-filter-oracle.cpp" -o "$ROOT/tmp/classic-filter-oracle"
"$ROOT/tmp/classic-filter-oracle" "$ROOT/tmp/classicFilterOracle.fixture.bin"
cmp "$ROOT/tmp/classicFilterOracle.fixture.bin" "$ROOT/src/lib/classicFilterOracle.fixture.bin"
npm --prefix "$ROOT" test -- --run src/lib/classicFilterEffect.oracle.test.ts
