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

## Audacity Echo algorithm

- Upstream: https://github.com/audacity/audacity
- Effect and control source: https://github.com/audacity/audacity/blob/master/au3/src/effects/Echo.cpp
- DSP source: https://github.com/audacity/audacity/blob/master/au3/libraries/au3-builtin-effects/EchoBase.cpp
- Manual: https://manual.audacityteam.org/man/echo.html
- Purpose: GPL-licensed parameter and per-channel recursive delay-line reference for `src/lib/echoEffect.ts` and its editor integration
- License: GNU GPL Version 3; this repository's corresponding license is preserved in [`LICENSE`](LICENSE)

The implementation follows the upstream defaults of 1 second delay and 0.5 decay, integer `sampleRate * delay` history length, independent per-channel history, and the recurrence `output = input + history[position] * decay` with the output written back to the same history position. It preserves the manual contract that Echo does not extend audio beyond the selection and renders time-stretched clips before applying the effect. Browser rendering uses bounded history allocations of 5,000,000 samples per track and 10,000,000 samples across a multi-track operation instead of the upstream floating-point maximum delay. Automated tests use independently calculated recurrences and boundary cases; no Audacity executable or upstream golden audio is bundled, and no claim of runtime golden-file equivalence is made.

## Audacity Wah Wah algorithm

- Upstream release: https://github.com/audacity/audacity/releases/tag/Audacity-4.0.2
- Parameter source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/au3/libraries/au3-builtin-effects/WahWahBase.h
- DSP source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/au3/libraries/au3-builtin-effects/WahWahBase.cpp
- Manual: https://manual.audacityteam.org/man/wahwah.html
- Purpose: GPL-licensed six-parameter LFO band-pass reference for `src/lib/wahWahEffect.ts` and its editor integration
- License: GNU GPL Version 3; this repository's corresponding license is preserved in [`LICENSE`](LICENSE)

The implementation follows the Audacity 4.0.2 release algorithm: default controls of 1.5 Hz, 0 degrees, 70% depth, 2.5 resonance, 30% frequency offset and -6 dB output gain; coefficient recomputation every 30 samples with the upstream initial `skipcount` increment order; recursive history stored before output gain; and Float32 output storage. Each channel is initialized and processed independently, without claiming the unverified stereo phase behaviour of another upstream revision. Tests compare selected samples with an independently calculated numerical baseline and cover coefficient boundaries, invalid inputs, silence, empty inputs and unequal channel lengths. The current `master` formula was not used as the baseline, and no Audacity executable or upstream golden audio is bundled.

## Audacity Bass and Treble algorithm

- Upstream release: https://github.com/audacity/audacity/releases/tag/Audacity-4.0.2
- Parameter source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/au3/libraries/au3-builtin-effects/BassTrebleBase.h
- DSP source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/au3/libraries/au3-builtin-effects/BassTrebleBase.cpp
- Dialog and linked-volume source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/au3/src/effects/BassTreble.cpp
- Purpose: GPL-licensed two-stage shelving-IIR, parameter, and linked-volume reference for `src/lib/bassTrebleEffect.ts` and its editor integration
- License: GNU GPL Version 3; this repository's corresponding license is preserved in [`LICENSE`](LICENSE)

The implementation follows the Audacity 4.0.2 release algorithm: a 250 Hz low shelf followed by a 4 kHz high shelf, both using slope 0.4; bass, treble and output gain controls from -30 to 30 dB with zero defaults; final output gain after the filters; and linked-volume compensation using half the change for boosts and one quarter for cuts, clamped to the output-gain range. Each channel owns independent recursive history that can continue across selected clips. Tests compare selected samples with an independently calculated numerical baseline, verify segmented-versus-contiguous processing and cover channel isolation, invalid inputs, silence, gain-only processing and Float32 output storage. No Audacity executable or upstream golden audio is bundled, and no claim of equivalence with other upstream revisions is made.

## Audacity Click Removal algorithm

- Upstream release: https://github.com/audacity/audacity/releases/tag/Audacity-4.0.2
- DSP source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/effects/builtin_collection/clickremoval/clickremovaleffect.cpp
- Parameter and view-model source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/effects/builtin_collection/clickremoval/clickremovalviewmodel.cpp
- QML source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/effects/builtin_collection/clickremoval/ClickRemovalView.qml
- Purpose: GPL-licensed multi-scale RMS click detector, linear replacement, parameter, and dialog reference for `src/lib/clickRemovalEffect.ts` and its editor integration
- License: GNU GPL Version 3; this repository's corresponding license is preserved in [`LICENSE`](LICENSE)

The implementation follows Audacity 4.0.2: Threshold defaults to 200 with range 0–900 and step 10; Max spike width defaults to 20 with range 0–40 and step 10. Either zero parameter skips processing. Each track selection must contain more than 4096 samples. The detector uses 8192-sample zero-padded windows at 4096-sample steps, the initial 2049/2048 cascade, multiple spike-width scales, and linear replacement from the samples on either side. If no sample is changed, the official ineffective-audio diagnostic is returned without committing audio. Tests compare an 8192-sample result against an independently compiled C++ oracle derived from the official function, including all output samples and the replacement count. No Audacity executable or upstream golden audio is bundled.

## Audacity Noise Reduction algorithm

- Upstream release: https://github.com/audacity/audacity/releases/tag/Audacity-4.0.2
- DSP source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/effects/builtin_collection/noisereduction/noisereductioneffect.cpp
- Parameter and QML source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/effects/builtin_collection/noisereduction/noisereductionviewmodel.cpp and https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/effects/builtin_collection/noisereduction/NoiseReductionView.qml
- Spectral transformation source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/au3/libraries/au3-fft/SpectrumTransformer.cpp and https://github.com/audacity/audacity/blob/Audacity-4.0.2/au3/libraries/au3-fft/RealFFTf.cpp
- Purpose: GPL-licensed two-pass noise-profile statistics, spectral discrimination, smoothing, FFT/OLA, parameter and dialog reference for `src/lib/noiseReductionEffect.ts` and its editor integration
- License: GNU GPL Version 3; this repository's corresponding license is preserved in [`LICENSE`](LICENSE)

The implementation follows Audacity 4.0.2's fixed advanced settings: 2048-sample Hann/Hann windows, four steps per window, 512-sample steps and 1025 power-spectrum bins; second-greatest noise discrimination; 0.02-second attack and 0.1-second release; geometric frequency smoothing; and Reduce or Noise-only residue output. Defaults and ranges are 6 dB (0–48 integer), Sensitivity 6 (0.01–24), and Frequency smoothing 6 bands (0–12 integer). Profiles are weighted by complete windows across selected tracks and channels, and processing rejects a sample-rate mismatch. The standalone C++ oracle in `scripts/noise-reduction-oracle.cpp` independently implements the same numerical contract with `std::complex` FFT; its committed PCM fixture is generated locally and checked by `npm run test:noise-reduction:oracle`. No Audacity executable or upstream golden audio is bundled.

## Audacity Loudness Normalization / EBU R128 algorithm

- Upstream release: https://github.com/audacity/audacity/releases/tag/Audacity-4.0.2
- Effect and parameter source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/effects/builtin_collection/normalizeloudness/normalizeloudnesseffect.cpp and https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/effects/builtin_collection/normalizeloudness/normalizeloudnessviewmodel.cpp
- QML source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/effects/builtin_collection/normalizeloudness/NormalizeLoudnessView.qml
- EBU R128 and biquad source: https://github.com/audacity/audacity/blob/Audacity-4.0.2/au3/libraries/au3-math/EBUR128.cpp and https://github.com/audacity/audacity/blob/Audacity-4.0.2/au3/libraries/au3-math/Biquad.cpp
- Purpose: GPL-licensed loudness/RMS analysis, dual-mono/stereo, gating, parameter and dialog reference for `src/lib/loudnessEffect.ts` and its editor integration
- License: GNU GPL Version 3; this repository's corresponding license is preserved in [`LICENSE`](LICENSE)

The implementation follows Audacity 4.0.2's two-stage K-weighting, double-state/float-return biquads, 400ms blocks, 100ms steps, 65,536-bin loudness histogram, absolute/relative gating and incomplete-short-selection fallback. Linked LUFS combines stereo channel power; linked RMS combines the two channels in the quadratic domain. Independently processed stereo channels use the official −3 LU rule, while true mono applies it only when dual-mono is enabled. `scripts/loudness-oracle.cpp` independently generates eight frozen cases covering LUFS/RMS, mono/stereo, linked/independent channels, short selections and 8k/44.1kHz sample rates; `npm run test:loudness:oracle` regenerates and compares the fixture, then checks every gain and PCM sample. No Audacity executable or upstream golden audio is bundled.

## Other dependencies

Other direct and transitive dependencies retain their respective names, versions, license metadata, and license texts in their npm packages. See `package.json` and `package-lock.json` for the reproducible dependency inventory.
