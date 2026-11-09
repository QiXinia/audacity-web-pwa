# Third-party notices

This project is an independent, unofficial application and is not affiliated with the Audacity team.

## @breezystack/lamejs

- Upstream: https://github.com/shijinyu/lamejs
- Npm package: `@breezystack/lamejs`
- Purpose: client-side MP3 encoding
- License: LGPL-3.0

The upstream license text is preserved in [`licenses/lamejs-LGPL-3.0.txt`](licenses/lamejs-LGPL-3.0.txt). The package remains an independently distributed dependency and is installed from npm; no claim of upstream endorsement is made.

## Audacity / Nyquist Pluck algorithm

- Upstream: https://github.com/audacity/audacity
- Plug-in contract: https://github.com/audacity/audacity/blob/master/share/nyquist-plug-ins/pluck.ny
- DSP source: https://github.com/audacity/audacity/blob/Audacity-3.7.3/lib-src/libnyquist/nyquist/tran/pluck.c
- Purpose: GPL-licensed algorithm reference for the TypeScript Pluck generator in `src/lib/pluckGenerator.ts`
- License: GNU GPL Version 3; this repository's corresponding license is preserved in [`LICENSE`](LICENSE)

No Audacity or Nyquist executable, plug-in binary, or upstream golden audio file is bundled. The automated tests include independently calculated Python reference values for the official uint32 random-number overflow, float32 delay-line storage, pointer wrapping, fade, and peak-normalization behavior. The source-version claim is limited to Audacity 3.7.3 DSP plus the current plug-in contract; it is not a claim of byte-for-byte equivalence with every Nyquist version embedded in Audacity master.

## Other dependencies

Other direct and transitive dependencies retain their respective names, versions, license metadata, and license texts in their npm packages. See `package.json` and `package-lock.json` for the reproducible dependency inventory.
