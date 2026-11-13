#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/tmp"
g++ -std=c++17 -O2 "$ROOT/scripts/phaser-oracle.cpp" -o "$ROOT/tmp/phaser-oracle"
"$ROOT/tmp/phaser-oracle" "$ROOT/tmp/phaserOracle.fixture.bin"
cmp "$ROOT/tmp/phaserOracle.fixture.bin" "$ROOT/src/lib/phaserOracle.fixture.bin"
npm --prefix "$ROOT" test -- --run src/lib/phaserEffect.oracle.test.ts
