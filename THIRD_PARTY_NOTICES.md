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

## Audacity / Nyquist Rhythm Track algorithm

- Upstream: https://github.com/audacity/audacity
- Plug-in and control source: https://github.com/audacity/audacity/blob/master/share/nyquist-plug-ins/rhythmtrack.ny
- Manual: https://manual.audacityteam.org/man/rhythm_track.html
- Purpose: GPL-licensed timing, parameter, oscillator, filter, envelope, and click-synthesis reference for `src/lib/rhythmTrackGenerator.ts`
- License: GNU GPL Version 3; this repository's corresponding license is preserved in [`LICENSE`](LICENSE)

The implementation follows the current plug-in's tempo, beats-per-bar, alternate-beat Swing, bars-or-duration scheduling, start offset, eight beat sounds, and 0.75/0.5 strong/weak gain contract. Its current-source defaults are MIDI 84 for strong beats and MIDI 80 for weak beats. Nyquist low-pass/high-pass filters, exponential envelopes, and `jcrev` are browser-side structural adaptations; no Audacity executable or upstream golden audio was used, and the tests do not claim bit-exact waveform equivalence. Browser rendering rejects allocations above 50,000,000 samples rather than risking an out-of-memory failure.

## Audacity / Nyquist Risset Drum algorithm

- Upstream: https://github.com/audacity/audacity
- Plug-in and control source: https://github.com/audacity/audacity/blob/master/share/nyquist-plug-ins/rissetdrum.ny
- Manual: https://manual.audacityteam.org/man/risset_drum.html
- Purpose: GPL-licensed control, harmonic-oscillator, noise-modulation, percussion-envelope, and normalization reference for `src/lib/rissetDrumGenerator.ts`
- License: GNU GPL Version 3; this repository's corresponding license is preserved in [`LICENSE`](LICENSE)

The implementation uses the official 10/16/22/23 harmonic table at 0.1 times the selected frequency, centre-frequency modulation of filtered white noise, half-duration and full-duration percussion envelopes, and final peak normalization. The percentage control is converted from 0–100 to a 0–1 mix according to the visible control contract rather than reproducing the upstream text's direct `1-NOISE` expression literally. The wavetable oscillator, white-noise generator and `lowpass6` primitive are structural browser-side adaptations; no Audacity executable or upstream golden audio was used, and the tests do not claim bit-exact waveform equivalence. Browser rendering rejects allocations above 50,000,000 samples.

## Other dependencies

Other direct and transitive dependencies retain their respective names, versions, license metadata, and license texts in their npm packages. See `package.json` and `package-lock.json` for the reproducible dependency inventory.
