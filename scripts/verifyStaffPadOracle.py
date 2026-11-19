#!/usr/bin/env python3
"""Rebuild the committed PCM fixtures with Audacity's official native StaffPad code.

Required environment:
  AUDACITY_SOURCE_DIR: Audacity 4.0.2 tree (tested at 7472497768314bcd4c641ef6dc91e366d92b2fcc)
  PFFFT_SOURCE_DIR: PFFFT tree (tested at 67a4a6a113179ab4ac398298f46fce8dd60498dc)

The script compiles in a temporary directory and compares fresh native output
byte-for-byte with src/test/fixtures/staffpad. Vitest then independently compares
the TypeScript browser port against those committed native outputs.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "src/test/fixtures/staffpad"
ORACLE = ROOT / "src/test/oracle/staffpad"


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def main() -> None:
    audacity = Path(os.environ["AUDACITY_SOURCE_DIR"]).resolve()
    pffft = Path(os.environ["PFFFT_SOURCE_DIR"]).resolve()
    libraries = audacity / "au3/libraries"
    time_and_pitch = libraries / "au3-time-and-pitch"
    manifest = json.loads((FIXTURES / "oracle.json").read_text())
    with tempfile.TemporaryDirectory(prefix="audacity-staffpad-oracle-") as temporary:
        build = Path(temporary)
        pffft_object = build / "pffft.o"
        executable = build / "staffpad-oracle"
        run("gcc", "-O2", f"-I{pffft}", "-c", str(pffft / "pffft.c"), "-o", str(pffft_object))
        sources = [
            ORACLE / "staffpad-oracle.cpp",
            ORACLE / "settings.cpp",
            time_and_pitch / "StaffPadTimeAndPitch.cpp",
            time_and_pitch / "FormantShifter.cpp",
            time_and_pitch / "FormantShifterLogger.cpp",
            time_and_pitch / "DummyFormantShifterLogger.cpp",
            time_and_pitch / "TimeAndPitchInterface.cpp",
            time_and_pitch / "AudioContainer.cpp",
            time_and_pitch / "StaffPad/TimeAndPitch.cpp",
            time_and_pitch / "StaffPad/FourierTransform_pffft.cpp",
        ]
        run(
            "g++", "-std=c++17", "-O2", "-DTIME_AND_PITCH_API=",
            f"-I{time_and_pitch}", f"-I{libraries}", f"-I{pffft}",
            *(str(source) for source in sources), str(pffft_object),
            "-o", str(executable), "-lm",
        )
        for case in manifest["cases"]:
            output = build / f"{case['name']}-native.f32"
            run(
                str(executable), str(FIXTURES / f"{case['name']}-input.f32"), str(output),
                str(case["channels"]), str(case["sampleRate"]), str(case["timeRatio"]),
                str(case["pitchRatio"]), str(int(case["preserveFormants"])), str(case["fftSize"]),
            )
            expected = FIXTURES / f"{case['name']}-native.f32"
            if output.read_bytes() != expected.read_bytes():
                raise AssertionError(f"Native oracle changed: {case['name']}")
            print(f"native oracle byte-identical: {case['name']}")


if __name__ == "__main__":
    main()
