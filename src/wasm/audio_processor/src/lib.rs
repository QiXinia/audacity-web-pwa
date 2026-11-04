//! Audio processing WASM module
//!
//! Provides DSP operations for the Audacity Web editor:
//! - Gain adjustment
//! - Fade in / fade out
//! - FFT-based spectrum analysis
//! - Normalization
//! - DC offset removal
//! - Reverse
//! - Invert

mod wav;
pub use wav::*;

use wasm_bindgen::prelude::*;

/// Apply gain to a mono audio buffer.
/// gain_linear: linear gain multiplier (use db_to_linear helper on JS side)
#[wasm_bindgen]
pub fn apply_gain(buffer: &mut [f32], gain_linear: f32) {
    for sample in buffer.iter_mut() {
        *sample *= gain_linear;
    }
}

/// Apply fade in to the beginning of a buffer.
/// duration_samples: number of samples over which to fade
#[wasm_bindgen]
pub fn apply_fade_in(buffer: &mut [f32], duration_samples: usize) {
    let n = duration_samples.min(buffer.len());
    if n == 0 {
        return;
    }
    let step = 1.0 / n as f32;
    for i in 0..n {
        buffer[i] *= i as f32 * step;
    }
}

/// Apply fade out to the end of a buffer.
/// duration_samples: number of samples over which to fade
#[wasm_bindgen]
pub fn apply_fade_out(buffer: &mut [f32], duration_samples: usize) {
    let n = duration_samples.min(buffer.len());
    if n == 0 {
        return;
    }
    let step = 1.0 / n as f32;
    let start = buffer.len() - n;
    for i in 0..n {
        buffer[start + i] *= (n - i) as f32 * step;
    }
}

/// Normalize audio to a target peak level.
/// target_db: target peak in dB (e.g. -1.0 for -1dB headroom)
/// Returns the applied gain in linear units.
#[wasm_bindgen]
pub fn normalize(buffer: &mut [f32], target_db: f32) -> f32 {
    let mut peak = 0.0f32;
    for &sample in buffer.iter() {
        let abs = sample.abs();
        if abs > peak {
            peak = abs;
        }
    }
    if peak == 0.0 {
        return 1.0;
    }
    let target_linear = 10.0f32.powf(target_db / 20.0);
    let gain = target_linear / peak;
    for sample in buffer.iter_mut() {
        *sample *= gain;
    }
    gain
}

/// Remove DC offset from audio buffer.
#[wasm_bindgen]
pub fn remove_dc_offset(buffer: &mut [f32]) -> f32 {
    if buffer.is_empty() {
        return 0.0;
    }
    let mut sum = 0.0f32;
    for &sample in buffer.iter() {
        sum += sample;
    }
    let dc = sum / buffer.len() as f32;
    for sample in buffer.iter_mut() {
        *sample -= dc;
    }
    dc
}

/// Reverse the audio buffer in place.
#[wasm_bindgen]
pub fn reverse(buffer: &mut [f32]) {
    buffer.reverse();
}

/// Invert the phase of the audio buffer in place.
#[wasm_bindgen]
pub fn invert_phase(buffer: &mut [f32]) {
    for sample in buffer.iter_mut() {
        *sample = -*sample;
    }
}

/// Compute RMS level of a buffer.
/// Returns RMS value as linear amplitude.
#[wasm_bindgen]
pub fn compute_rms(buffer: &[f32]) -> f32 {
    if buffer.is_empty() {
        return 0.0;
    }
    let mut sum_sq = 0.0f64;
    for &sample in buffer.iter() {
        sum_sq += (sample as f64) * (sample as f64);
    }
    (sum_sq / buffer.len() as f64).sqrt() as f32
}

/// Compute peak amplitude of a buffer.
#[wasm_bindgen]
pub fn compute_peak(buffer: &[f32]) -> f32 {
    let mut peak = 0.0f32;
    for &sample in buffer.iter() {
        let abs = sample.abs();
        if abs > peak {
            peak = abs;
        }
    }
    peak
}

/// Simple FFT implementation (Cooley-Tukey, power-of-two).
/// input: real-valued input samples
/// output: magnitude spectrum (half length + 1), each value is magnitude
#[wasm_bindgen]
pub fn fft_magnitude(input: &[f32]) -> Vec<f32> {
    let n = input.len();
    if n == 0 {
        return Vec::new();
    }
    // Round up to next power of 2
    let mut size = 1;
    while size < n {
        size <<= 1;
    }
    // Pad with zeros
    let mut real = vec![0.0f32; size];
    let mut imag = vec![0.0f32; size];
    real[..n].copy_from_slice(input);

    // Bit-reversal permutation
    let mut j = 0usize;
    for i in 1..size {
        let mut bit = size >> 1;
        while j >= bit {
            j -= bit;
            bit >>= 1;
        }
        j += bit;
        if i < j {
            real.swap(i, j);
            imag.swap(i, j);
        }
    }

    // FFT
    let mut len = 2;
    while len <= size {
        let half = len >> 1;
        let angle = std::f32::consts::PI * 2.0 / len as f32;
        let w_r = angle.cos();
        let w_i = -angle.sin();

        for i in (0..size).step_by(len) {
            let mut wr = 1.0f32;
            let mut wi = 0.0f32;
            for k in 0..half {
                let tr = real[i + k + half] * wr - imag[i + k + half] * wi;
                let ti = real[i + k + half] * wi + imag[i + k + half] * wr;
                real[i + k + half] = real[i + k] - tr;
                imag[i + k + half] = imag[i + k] - ti;
                real[i + k] += tr;
                imag[i + k] += ti;
                let new_wr = wr * w_r - wi * w_i;
                wi = wr * w_i + wi * w_r;
                wr = new_wr;
            }
        }
        len <<= 1;
    }

    // Compute magnitude spectrum (half + 1)
    let out_len = size / 2 + 1;
    let mut result = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let mag = (real[i] * real[i] + imag[i] * imag[i]).sqrt();
        result.push(mag);
    }
    result
}

/// Generate spectrogram data from a buffer.
/// window_size: FFT window size (must be power of 2)
/// hop_size: step between windows in samples
/// Returns flat vector of magnitude values, row-major: [num_frames * (window_size/2 + 1)]
#[wasm_bindgen]
pub fn spectrogram(input: &[f32], window_size: usize, hop_size: usize) -> Vec<f32> {
    if hop_size == 0 || window_size == 0 || input.is_empty() {
        return Vec::new();
    }
    let num_frames = if input.len() <= window_size {
        1
    } else {
        (input.len() - window_size) / hop_size + 1
    };
    let spec_len = window_size / 2 + 1;
    let mut result = Vec::with_capacity(num_frames * spec_len);

    // Hann window precomputation
    let mut window = vec![0.0f32; window_size];
    for i in 0..window_size {
        let t = i as f32 / (window_size - 1) as f32;
        window[i] = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * t).cos());
    }

    let mut frame = vec![0.0f32; window_size];
    for f in 0..num_frames {
        let start = f * hop_size;
        let end = (start + window_size).min(input.len());
        let actual_len = end - start;

        // Apply window
        for i in 0..actual_len {
            frame[i] = input[start + i] * window[i];
        }
        for i in actual_len..window_size {
            frame[i] = 0.0;
        }

        let mag = fft_magnitude(&frame);
        result.extend_from_slice(&mag);
    }
    result
}

/// Apply a simple hard knee compressor to a mono buffer.
/// threshold_db: threshold in dB
/// ratio: compression ratio (e.g. 4.0 for 4:1)
/// attack_ms: attack time in ms
/// release_ms: release time in ms
/// sample_rate: sample rate in Hz
#[wasm_bindgen]
pub fn apply_compressor(
    buffer: &mut [f32],
    threshold_db: f32,
    ratio: f32,
    attack_ms: f32,
    release_ms: f32,
    sample_rate: f32,
) {
    if buffer.is_empty() || ratio <= 1.0 {
        return;
    }
    let threshold_lin = 10.0f32.powf(threshold_db / 20.0);
    let attack_coeff = if attack_ms > 0.0 {
        (-1.0 / (sample_rate * attack_ms / 1000.0)).exp()
    } else {
        0.0
    };
    let release_coeff = if release_ms > 0.0 {
        (-1.0 / (sample_rate * release_ms / 1000.0)).exp()
    } else {
        0.0
    };

    let mut envelope = 0.0f32;
    for sample in buffer.iter_mut() {
        let input_abs = sample.abs();
        // Envelope follower
        let coeff = if input_abs > envelope {
            attack_coeff
        } else {
            release_coeff
        };
        envelope = coeff * envelope + (1.0 - coeff) * input_abs;

        if envelope > threshold_lin {
            let input_db = 20.0 * envelope.log10();
            let excess = input_db - threshold_db;
            let output_db = threshold_db + excess / ratio;
            let gain_reduction_db = output_db - input_db;
            let gain = 10.0f32.powf(gain_reduction_db / 20.0);
            *sample *= gain;
        }
    }
}

/// Concatenate two audio buffers (mono).
#[wasm_bindgen]
pub fn concat_buffers(a: &[f32], b: &[f32]) -> Vec<f32> {
    let mut result = Vec::with_capacity(a.len() + b.len());
    result.extend_from_slice(a);
    result.extend_from_slice(b);
    result
}

/// Slice a mono buffer from start to end sample index.
#[wasm_bindgen]
pub fn slice_buffer(buffer: &[f32], start: usize, end: usize) -> Vec<f32> {
    let s = start.min(buffer.len());
    let e = end.min(buffer.len()).max(s);
    buffer[s..e].to_vec()
}

/// Mix two mono buffers with equal gain.
#[wasm_bindgen]
pub fn mix_buffers(a: &[f32], b: &[f32]) -> Vec<f32> {
    let len = a.len().max(b.len());
    let mut result = vec![0.0f32; len];
    for i in 0..a.len() {
        result[i] += a[i];
    }
    for i in 0..b.len() {
        result[i] += b[i];
    }
    result
}
