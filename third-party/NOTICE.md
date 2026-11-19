# Third-party notices — High-quality Sample Rate Converter

This application distributes the following components for its libsoxr-backed
sample-rate converter.

## wasm-audio-resampler 2.0.0

- Copyright (c) 2020 Guillaume Besson.
- License: MIT; see `wasm-audio-resampler/LICENSE` beside this notice.
- Package and corresponding source: https://github.com/geekuillaume/wasm-audio-resampler
- Source tag reviewed: `v2.0.0`, commit `93a19febc96d03ef98bede78434d3c0989373477`.
- Build instructions and the upstream Emscripten patch are in that repository's
  `Readme.md`, `scripts/build_emscripten.sh`, and `deps/soxr_emscripten.patch`.

## Soxr

- Author identified by upstream: Rob Sykes <robs@users.sourceforge.net>.
- License: GNU Lesser General Public License, version 2.1; see
  `soxr/COPYING.LGPL` and `soxr/AUTHORS` beside this notice.
- Upstream source: https://git.code.sf.net/p/soxr/code
- The wrapper's `v2.0.0` git tree records Soxr submodule revision
  `59f66fdcc7e4761f837dda8819a6f3793086544a`.
- Independent native numerical verification for this application used upstream
  Soxr `0.1.3`, commit `945b592b70470e29f917f4de89b4281fbbd540c0`.

The Soxr WebAssembly module is emitted as a separate hashed `.wasm` asset and is
loaded at runtime. It can be replaced by a rebuilt compatible module without
editing the application's JavaScript bundle. The application source, quality
mapping, raw C API adapter and numerical oracle tests are available at:
https://github.com/QiXinia/audacity-web-pwa
