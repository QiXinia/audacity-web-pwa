#!/usr/bin/env python3
"""Reproduce the exact PFFFT WASM and native setup corrections used by StaffPad.

The source revision, Emscripten version, SIMD branch and native glibc twiddle
semantics are all intentional. Changing any of them requires regenerating the
fixtures and rerunning the StaffPad native-oracle tests.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

PFFFT_COMMIT = "67a4a6a113179ab4ac398298f46fce8dd60498dc"
EMSCRIPTEN_VERSION = "3.1.74"
SETUP_DATA_POINTER_OFFSET = 116
SIZES = tuple(2**power for power in range(6, 17))
REPO_ROOT = Path(__file__).resolve().parent.parent
WASM_MODULE = REPO_ROOT / "src/lib/pffftWasmBase64.ts"
SETUP_MODULE = REPO_ROOT / "src/lib/pffftSetupCorrections.ts"

NATIVE_DUMP = r'''#include "pffft.c"

int main(int argc, char** argv)
{
    if (argc != 2) return 2;
    FILE* output = fopen(argv[1], "wb");
    if (!output) return 3;
    for (int n = 64; n <= 65536; n *= 2) {
        PFFFT_Setup* setup = pffft_new_setup(n, PFFFT_REAL);
        if (!setup) return 4;
        if (fwrite(setup->data, sizeof(float), n, output) != (size_t)n) return 5;
        pffft_destroy_setup(setup);
    }
    fclose(output);
    return 0;
}
'''

WASM_DUMP = '''import {{ writeFileSync }} from 'node:fs';
import PFFFT from {module_path};

const module = await PFFFT();
const sizes = {sizes};
const output = new Uint8Array(sizes.reduce((sum, size) => sum + size * 4, 0));
let offset = 0;
for (const size of sizes) {{
  const setup = module._pffft_new_setup(size, 0);
  if (!setup) throw new Error(`No setup for ${{size}}`);
  const data = module.HEAPU32[(setup + {pointer_offset}) / 4];
  if (!data || data % 16 !== 0) throw new Error(`Invalid setup data pointer for ${{size}}`);
  output.set(new Uint8Array(module.HEAPF32.buffer, data, size * 4), offset);
  offset += size * 4;
  module._pffft_destroy_setup(setup);
}}
writeFileSync({output_path}, output);
'''


def run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=True, text=True, **kwargs)


def emcc(emsdk: Path, arguments: list[str]) -> subprocess.CompletedProcess[str]:
    # emsdk_env.sh supplies the pinned node, clang and sysroot without changing
    # the caller's shell. The first argument is consumed before forwarding "$@".
    return run([
        "bash", "-c",
        'source "$1/emsdk_env.sh" >/dev/null && shift && emcc "$@"',
        "build-staffpad-pffft", str(emsdk), *arguments,
    ], capture_output=True)


def wasm_source(wasm: bytes) -> str:
    encoded = base64.b64encode(wasm).decode("ascii")
    return (
        "// SPDX-License-Identifier: LicenseRef-FFTPACK\n"
        f"// Generated from Audacity's pinned PFFFT {PFFFT_COMMIT} with Emscripten {EMSCRIPTEN_VERSION}.\n"
        "// Rebuild with scripts/build-staffpad-pffft.py; do not substitute another PFFFT version.\n"
        f'export const PFFFT_WASM_BASE64 = "{encoded}";\n'
    )


def corrections_source(native: bytes, wasm: bytes) -> tuple[str, int]:
    expected_bytes = sum(SIZES) * 4
    if len(native) != expected_bytes or len(wasm) != expected_bytes:
        raise RuntimeError(
            f"Unexpected setup dump lengths: native={len(native)}, wasm={len(wasm)}, "
            f"expected={expected_bytes}"
        )
    lines = [
        "// SPDX-License-Identifier: LicenseRef-FFTPACK",
        "// Generated native glibc float setup corrections for the pinned PFFFT WASM build.",
        "// Each tuple is a float index in PFFFT_Setup::data and its native uint32 bit pattern.",
        f"export const PFFFT_SETUP_DATA_POINTER_OFFSET = {SETUP_DATA_POINTER_OFFSET};",
        "",
        "export const PFFFT_SETUP_CORRECTIONS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {",
    ]
    float_offset = 0
    total = 0
    for size in SIZES:
        lines.append(f"  {size}: [")
        for index in range(size):
            position = (float_offset + index) * 4
            native_bits = struct.unpack_from("<I", native, position)[0]
            wasm_bits = struct.unpack_from("<I", wasm, position)[0]
            if native_bits != wasm_bits:
                lines.append(f"    [{index}, 0x{native_bits:08x}],")
                total += 1
        lines.append("  ],")
        float_offset += size
    lines.append("};\n")
    return "\n".join(lines), total


def compare_or_write(path: Path, content: str, write: bool) -> None:
    encoded = content.encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()
    if write:
        path.write_bytes(encoded)
        print(f"wrote {path.relative_to(REPO_ROOT)} sha256={digest}")
        return
    actual = path.read_bytes()
    if actual != encoded:
        raise RuntimeError(
            f"{path.relative_to(REPO_ROOT)} differs from the regenerated artifact: "
            f"actual_sha256={hashlib.sha256(actual).hexdigest()} expected_sha256={digest}. "
            "Rerun with --write only after reviewing the toolchain and numerical changes."
        )
    print(f"verified {path.relative_to(REPO_ROOT)} sha256={digest}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pffft-source", type=Path, required=True,
                        help=f"checkout of marton78/pffft at {PFFFT_COMMIT}")
    parser.add_argument("--emsdk", type=Path, required=True,
                        help=f"emsdk checkout with Emscripten {EMSCRIPTEN_VERSION} activated")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true",
                      help="verify generated sources without modifying them (default)")
    mode.add_argument("--write", action="store_true",
                      help="replace the two generated TypeScript modules after validation")
    args = parser.parse_args()
    source = args.pffft_source.resolve()
    emsdk = args.emsdk.resolve()

    for relative in ("pffft.c", "pffft.h"):
        if not (source / relative).is_file():
            parser.error(f"missing {source / relative}")
    if not (emsdk / "emsdk_env.sh").is_file():
        parser.error(f"missing {emsdk / 'emsdk_env.sh'}")
    if shutil.which("gcc") is None or shutil.which("node") is None:
        parser.error("gcc and node are required")

    revision = run(["git", "-C", str(source), "rev-parse", "HEAD"],
                   capture_output=True).stdout.strip()
    if revision != PFFFT_COMMIT:
        parser.error(f"PFFFT revision is {revision}, expected {PFFFT_COMMIT}")
    version_output = emcc(emsdk, ["--version"])
    version = (version_output.stdout + version_output.stderr).splitlines()[0]
    if f"Emscripten gcc/clang-like replacement + linker emulating GNU ld) {EMSCRIPTEN_VERSION} " not in version:
        parser.error(f"unexpected compiler version: {version}")

    with tempfile.TemporaryDirectory(prefix="staffpad-pffft-") as temporary:
        work = Path(temporary)
        native_c = work / "native-all-setups.c"
        native_bin = work / "native-all-setups"
        native_f32 = work / "native-all-setups.f32"
        wasm_f32 = work / "wasm-all-setups.f32"
        wasm_js = work / "audacity-r317-exact-pffft.js"
        wasm_bin = work / "audacity-r317-exact-pffft.wasm"
        dump_mjs = work / "wasm-all-setups.mjs"
        native_c.write_text(NATIVE_DUMP, encoding="utf-8")
        dump_mjs.write_text(WASM_DUMP.format(
            module_path=json.dumps(str(wasm_js)),
            sizes=json.dumps(list(SIZES)),
            pointer_offset=SETUP_DATA_POINTER_OFFSET,
            output_path=json.dumps(str(wasm_f32)),
        ), encoding="utf-8")

        run(["gcc", "-O2", f"-I{source}", str(native_c), "-o", str(native_bin), "-lm"])
        run([str(native_bin), str(native_f32)])
        exports = "['_malloc', '_free', '_pffft_new_setup', '_pffft_destroy_setup', '_pffft_transform', '_pffft_transform_ordered', '_pffft_zreorder', '_pffft_zconvolve_accumulate', '_pffft_aligned_malloc', '_pffft_aligned_free', '_pffft_simd_size']"
        result = emcc(emsdk, [
            "-s", "WASM=1", "-s", "ALLOW_MEMORY_GROWTH=1",
            "-s", f"EXPORTED_FUNCTIONS={exports}",
            "-s", "EXPORTED_RUNTIME_METHODS=['getValue', 'setValue', 'cwrap']",
            "-s", "MODULARIZE=1", "-s", "EXPORT_ES6=1", "-s", 'EXPORT_NAME="PFFFT"',
            "-O3", "-msimd128", "-msse", "-U__wasm_simd128__",
            "-D", "__x86_64__=1", "-o", str(wasm_js), f"-I{source}", str(source / "pffft.c"),
        ])
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr)
        run(["node", str(dump_mjs)])

        wasm_bytes = wasm_bin.read_bytes()
        generated_wasm = wasm_source(wasm_bytes)
        generated_corrections, count = corrections_source(
            native_f32.read_bytes(), wasm_f32.read_bytes())
        print(f"PFFFT revision={revision} Emscripten={EMSCRIPTEN_VERSION} "
              f"wasm_bytes={len(wasm_bytes)} setup_corrections={count}")
        compare_or_write(WASM_MODULE, generated_wasm, args.write)
        compare_or_write(SETUP_MODULE, generated_corrections, args.write)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
