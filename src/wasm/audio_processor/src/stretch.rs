use wasm_bindgen::prelude::*;

fn next_power_of_two(value: usize) -> usize {
    let mut result = 1usize;
    while result < value {
        result <<= 1;
    }
    if result == 0 { 1 } else { result }
}

fn linear_stretch(input: &[f32], output_len: usize) -> Vec<f32> {
    let mut output = vec![0.0f32; output_len];
    if input.is_empty() {
        return output;
    }
    for (i, sample) in output.iter_mut().enumerate() {
        let position = i as f32 * input.len() as f32 / output_len as f32;
        let left = (position.floor() as usize).min(input.len() - 1);
        let right = (left + 1).min(input.len() - 1);
        let fraction = position - left as f32;
        *sample = input[left] * (1.0 - fraction) + input[right] * fraction;
    }
    output
}

/// Pitch-preserving WSOLA stretch on planar multi-channel audio.
/// All channels share analysis positions, preserving stereo alignment.
/// speed > 1 shortens; speed < 1 lengthens. Returns planar channels.
#[wasm_bindgen]
pub fn time_stretch(
    input: &[f32],
    channel_count: usize,
    speed: f32,
    sample_rate: f32,
) -> Vec<f32> {
    if channel_count == 0 || !speed.is_finite() || speed <= 0.0 || input.len() % channel_count != 0 {
        return Vec::new();
    }
    let input_frames = input.len() / channel_count;
    if input_frames == 0 {
        return Vec::new();
    }
    if (speed - 1.0).abs() < 0.000001 {
        return input.to_vec();
    }
    let output_len = ((input_frames as f32 / speed).round() as usize).max(1);
    if input_frames < 128 {
        let mut output = Vec::with_capacity(output_len * channel_count);
        for channel in 0..channel_count {
            let start = channel * input_frames;
            output.extend_from_slice(&linear_stretch(&input[start..start + input_frames], output_len));
        }
        return output;
    }

    let target_window = next_power_of_two(((sample_rate.max(1.0) * 0.046).round() as usize).max(64));
    let mut window_size = target_window.min(2048);
    while window_size > input_frames && window_size > 64 {
        window_size >>= 1;
    }
    if window_size < 64 {
        let mut output = Vec::with_capacity(output_len * channel_count);
        for channel in 0..channel_count {
            let start = channel * input_frames;
            output.extend_from_slice(&linear_stretch(&input[start..start + input_frames], output_len));
        }
        return output;
    }

    let overlap = window_size / 2;
    let synthesis_hop = overlap;
    let search_radius = (overlap / 4).max(16);
    let maximum_position = input_frames.saturating_sub(window_size);
    let window: Vec<f32> = (0..window_size)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (window_size - 1) as f32).cos())
        .collect();
    let mut mono = vec![0.0f32; input_frames];
    for i in 0..input_frames {
        for channel in 0..channel_count {
            mono[i] += input[channel * input_frames + i] / channel_count as f32;
        }
    }

    let sample_at = |position: isize| -> f32 {
        if position >= 0 && (position as usize) < input_frames {
            mono[position as usize]
        } else {
            0.0
        }
    };
    let correlation = |previous: usize, candidate: usize, step: usize| -> f32 {
        let mut dot = 0.0f32;
        let mut previous_energy = 1e-9f32;
        let mut candidate_energy = 1e-9f32;
        let mut i = 0usize;
        while i < overlap {
            let a = sample_at((previous + overlap + i) as isize);
            let b = sample_at((candidate + i) as isize);
            dot += a * b;
            previous_energy += a * a;
            candidate_energy += b * b;
            i += step;
        }
        dot / (previous_energy * candidate_energy).sqrt()
    };
    let best_position = |previous: usize, nominal: f32| -> usize {
        let center = (nominal.round() as isize).clamp(0, maximum_position as isize) as usize;
        let first = center.saturating_sub(search_radius);
        let last = (center + search_radius).min(maximum_position);
        let mut best = center;
        let mut best_score = f32::NEG_INFINITY;
        let mut candidate = first;
        while candidate <= last {
            let score = correlation(previous, candidate, 4);
            if score > best_score {
                best_score = score;
                best = candidate;
            }
            candidate += 8;
        }
        let coarse = best;
        best_score = f32::NEG_INFINITY;
        for candidate in coarse.saturating_sub(7)..=(coarse + 7).min(maximum_position) {
            let score = correlation(previous, candidate, 2);
            if score > best_score {
                best_score = score;
                best = candidate;
            }
        }
        best
    };

    let work_len = output_len + window_size;
    let mut work = vec![0.0f32; work_len * channel_count];
    let mut normalization = vec![0.0f32; work_len];
    let mut output_position = 0usize;
    let mut previous_position = 0usize;
    let mut frame_index = 0usize;
    while output_position < output_len {
        let nominal = output_position as f32 * speed;
        let position = if frame_index == 0 {
            (nominal.round() as isize).clamp(0, maximum_position as isize) as usize
        } else {
            best_position(previous_position, nominal)
        };
        for i in 0..window_size {
            let target = output_position + i;
            if target >= work_len {
                break;
            }
            let source = position + i;
            let weight = window[i];
            normalization[target] += weight;
            for channel in 0..channel_count {
                let sample = if source < input_frames {
                    input[channel * input_frames + source]
                } else {
                    0.0
                };
                work[channel * work_len + target] += sample * weight;
            }
        }
        previous_position = position;
        output_position += synthesis_hop;
        frame_index += 1;
    }

    let mut output = vec![0.0f32; output_len * channel_count];
    for channel in 0..channel_count {
        for i in 0..output_len {
            output[channel * output_len + i] = if normalization[i] > 1e-6 {
                work[channel * work_len + i] / normalization[i]
            } else {
                0.0
            };
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::time_stretch;

    #[test]
    fn preserves_normal_input_and_changes_duration() {
        let input: Vec<f32> = (0..8000).map(|i| (i as f32 * 0.1).sin() * 0.5).collect();
        assert_eq!(time_stretch(&input, 1, 1.0, 8000.0), input);
        assert_eq!(time_stretch(&input, 1, 2.0, 8000.0).len(), 4000);
        assert_eq!(time_stretch(&input, 1, 0.5, 8000.0).len(), 16000);
    }

    #[test]
    fn keeps_planar_stereo_lengths_equal() {
        let mut input = vec![0.0f32; 8000];
        for i in 0..4000 {
            input[i] = (i as f32 * 0.2).sin() * 0.4;
            input[4000 + i] = (i as f32 * 0.4).sin() * 0.2;
        }
        let output = time_stretch(&input, 2, 0.75, 8000.0);
        assert_eq!(output.len(), 10666);
        assert!(output.iter().all(|sample| sample.is_finite()));
    }

    #[test]
    fn preserves_constant_amplitude() {
        let mut input = vec![0.5f32; 4000];
        input[2000..].fill(0.25);
        for ratio in [0.5f32, 2.0f32] {
            let output = time_stretch(&input, 2, ratio, 8000.0);
            let frames = output.len() / 2;
            for i in (64..frames - 64).step_by(97) {
                assert!((output[i] - 0.5).abs() < 0.0001);
                assert!((output[frames + i] - 0.25).abs() < 0.0001);
            }
        }
    }

    #[test]
    fn rejects_invalid_layout_and_ratio() {
        assert!(time_stretch(&[0.0; 3], 2, 1.0, 8000.0).is_empty());
        assert!(time_stretch(&[0.0; 3], 1, 0.0, 8000.0).is_empty());
    }
}
