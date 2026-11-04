//! WAV encoder/decoder in Rust, compiled to WASM.
//!
//! Supports:
//! - Decode WAV files (PCM 8/16/24/32-bit, IEEE float 32-bit)
//! - Encode WAV files (PCM 16-bit, 24-bit, 32-bit float)

use wasm_bindgen::prelude::*;

/// Encode a mono or interleaved stereo audio buffer to WAV format (PCM 16-bit).
/// samples: interleaved samples for multi-channel
/// num_channels: 1 = mono, 2 = stereo
/// sample_rate: sample rate in Hz
/// Returns WAV file bytes.
#[wasm_bindgen]
pub fn encode_wav_pcm16(samples: &[f32], num_channels: u16, sample_rate: u32) -> Vec<u8> {
    let num_samples = samples.len() as u32;
    let bytes_per_sample = 2u32; // 16-bit
    let data_size = num_samples * bytes_per_sample;
    let file_size = 36 + data_size;

    let mut wav = Vec::with_capacity(file_size as usize + 8);

    // RIFF header
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&file_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");

    // fmt chunk
    wav.extend_from_slice(b"fmt ");
    let fmt_size: u32 = 16;
    wav.extend_from_slice(&fmt_size.to_le_bytes());
    let audio_format: u16 = 1; // PCM
    wav.extend_from_slice(&audio_format.to_le_bytes());
    wav.extend_from_slice(&num_channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate * num_channels as u32 * bytes_per_sample;
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    let block_align = num_channels * bytes_per_sample as u16;
    wav.extend_from_slice(&block_align.to_le_bytes());
    let bits_per_sample: u16 = 16;
    wav.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());

    // Convert f32 to int16
    for &sample in samples.iter() {
        let clamped = sample.clamp(-1.0, 1.0);
        let int_val = (clamped * 32767.0) as i16;
        wav.extend_from_slice(&int_val.to_le_bytes());
    }

    wav
}

/// Encode audio to 32-bit float WAV.
#[wasm_bindgen]
pub fn encode_wav_float32(samples: &[f32], num_channels: u16, sample_rate: u32) -> Vec<u8> {
    let num_samples = samples.len() as u32;
    let bytes_per_sample = 4u32;
    let data_size = num_samples * bytes_per_sample;
    let file_size = 36 + data_size;

    let mut wav = Vec::with_capacity(file_size as usize + 8);

    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&file_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");

    wav.extend_from_slice(b"fmt ");
    let fmt_size: u32 = 16;
    wav.extend_from_slice(&fmt_size.to_le_bytes());
    let audio_format: u16 = 3; // IEEE float
    wav.extend_from_slice(&audio_format.to_le_bytes());
    wav.extend_from_slice(&num_channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate * num_channels as u32 * bytes_per_sample;
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    let block_align = num_channels * bytes_per_sample as u16;
    wav.extend_from_slice(&block_align.to_le_bytes());
    let bits_per_sample: u16 = 32;
    wav.extend_from_slice(&bits_per_sample.to_le_bytes());

    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());

    for &sample in samples.iter() {
        wav.extend_from_slice(&sample.to_le_bytes());
    }

    wav
}

/// Decode a WAV file into f32 samples.
/// Returns interleaved f32 samples.
/// Sets num_channels and sample_rate via JS side by reading returned metadata.
/// On error returns empty vec.
#[wasm_bindgen(getter_with_clone)]
pub struct WavDecodeResult {
    pub samples: Vec<f32>,
    pub num_channels: u32,
    pub sample_rate: u32,
}

#[wasm_bindgen]
impl WavDecodeResult {
    #[wasm_bindgen(constructor)]
    pub fn new(samples: Vec<f32>, num_channels: u32, sample_rate: u32) -> WavDecodeResult {
        WavDecodeResult {
            samples,
            num_channels,
            sample_rate,
        }
    }
}

/// Decode WAV bytes.
#[wasm_bindgen]
pub fn decode_wav(data: &[u8]) -> Option<WavDecodeResult> {
    if data.len() < 44 {
        return None;
    }

    // Check RIFF
    if &data[0..4] != b"RIFF" {
        return None;
    }
    if &data[8..12] != b"WAVE" {
        return None;
    }

    let mut offset = 12;
    let mut num_channels: u16 = 1;
    let mut sample_rate: u32 = 44100;
    let mut bits_per_sample: u16 = 16;
    let mut audio_format: u16 = 1;
    let mut samples: Vec<f32> = Vec::new();

    // Parse chunks
    while offset + 8 <= data.len() {
        let chunk_id = &data[offset..offset + 4];
        let chunk_size = u32::from_le_bytes([
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        ]) as usize;
        offset += 8;

        if offset + chunk_size > data.len() {
            break;
        }

        match chunk_id {
            b"fmt " => {
                if chunk_size >= 16 {
                    audio_format = u16::from_le_bytes([data[offset], data[offset + 1]]);
                    num_channels = u16::from_le_bytes([data[offset + 2], data[offset + 3]]);
                    sample_rate = u32::from_le_bytes([
                        data[offset + 4],
                        data[offset + 5],
                        data[offset + 6],
                        data[offset + 7],
                    ]);
                    bits_per_sample =
                        u16::from_le_bytes([data[offset + 14], data[offset + 15]]);
                }
            }
            b"data" => {
                let bytes_per_sample = (bits_per_sample / 8) as usize;
                let total_samples = if bytes_per_sample > 0 {
                    chunk_size / bytes_per_sample
                } else {
                    0
                };
                samples = Vec::with_capacity(total_samples);

                match (audio_format, bits_per_sample) {
                    (1, 8) => {
                        // 8-bit unsigned PCM
                        for i in 0..total_samples {
                            let byte = data[offset + i];
                            let sample = (byte as f32 - 128.0) / 128.0;
                            samples.push(sample);
                        }
                    }
                    (1, 16) => {
                        // 16-bit signed PCM
                        for i in 0..total_samples {
                            let idx = offset + i * 2;
                            let val = i16::from_le_bytes([data[idx], data[idx + 1]]);
                            samples.push(val as f32 / 32768.0);
                        }
                    }
                    (1, 24) => {
                        // 24-bit signed PCM
                        for i in 0..total_samples {
                            let idx = offset + i * 3;
                            let mut val = (data[idx] as i32)
                                | ((data[idx + 1] as i32) << 8)
                                | ((data[idx + 2] as i32) << 16);
                            // Sign extend
                            if val & 0x800000 != 0 {
                                val |= !0xFFFFFF;
                            }
                            samples.push(val as f32 / 8388608.0);
                        }
                    }
                    (1, 32) => {
                        // 32-bit signed PCM
                        for i in 0..total_samples {
                            let idx = offset + i * 4;
                            let val = i32::from_le_bytes([
                                data[idx],
                                data[idx + 1],
                                data[idx + 2],
                                data[idx + 3],
                            ]);
                            samples.push(val as f32 / 2147483648.0);
                        }
                    }
                    (3, 32) => {
                        // 32-bit float
                        for i in 0..total_samples {
                            let idx = offset + i * 4;
                            let bytes = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
                            let val = f32::from_le_bytes(bytes);
                            samples.push(val);
                        }
                    }
                    _ => {
                        // Unsupported format, return early
                        return None;
                    }
                }
                break; // done after data
            }
            _ => {} // skip other chunks
        }

        // Chunks are 2-byte aligned
        offset += chunk_size + (chunk_size % 2);
    }

    Some(WavDecodeResult {
        samples,
        num_channels: num_channels as u32,
        sample_rate,
    })
}
