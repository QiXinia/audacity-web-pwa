// Independent Audacity 4.0.2 Noise Reduction oracle.
// Algorithm contract: au3 NoiseReductionEffect.cpp + SpectrumTransformer.cpp,
// Audacity-4.0.2 (7472497768314bcd4c641ef6dc91e366d92b2fcc).
// This harness deliberately uses an independent std::complex FFT implementation.
#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

static constexpr int N = 2048;
static constexpr int STEP = 512;
static constexpr int BINS = 1025;
static constexpr float PI = 3.14159265358979323846f;

struct Settings { float noiseGain = 6, sensitivity = 6; int smoothing = 6; bool residue = false; };
struct Profile { std::vector<float> means = std::vector<float>(BINS); int windows = 0; };
struct Window {
  std::vector<float> real = std::vector<float>(BINS), imaginary = std::vector<float>(BINS);
  std::vector<float> spectrum = std::vector<float>(BINS), gains = std::vector<float>(BINS);
};

static float fr(double value) { return static_cast<float>(value); }
static float db(double value) { return fr(std::pow(10.0, value / 20.0)); }

static void fft(std::vector<std::complex<double>>& values, bool inverse) {
  const int count = static_cast<int>(values.size());
  for (int i = 1, j = 0; i < count; ++i) {
    int bit = count >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(values[i], values[j]);
  }
  for (int length = 2; length <= count; length <<= 1) {
    const double angle = (inverse ? 2 : -2) * std::acos(-1.0) / length;
    const std::complex<double> root(std::cos(angle), std::sin(angle));
    for (int start = 0; start < count; start += length) {
      std::complex<double> factor(1);
      for (int offset = 0; offset < length / 2; ++offset) {
        const auto even = values[start + offset];
        const auto odd = values[start + offset + length / 2] * factor;
        values[start + offset] = even + odd;
        values[start + offset + length / 2] = even - odd;
        factor *= root;
      }
    }
  }
  if (inverse) for (auto& value : values) value /= count;
}

static std::vector<float> hann() {
  std::vector<float> result(N, 1.0f);
  const double multiplier = 2 * std::acos(-1.0) / N;
  for (int i = 0; i < N; ++i) result[i] = fr(result[i] * (0.5 - 0.5 * std::cos(i * multiplier)));
  return result;
}

static bool secondGreatest(const std::vector<Window>& queue, int count, int band, float threshold) {
  float greatest = 0, second = 0;
  for (int index = 0; index < count; ++index) {
    const float power = queue[index].spectrum[band];
    if (power >= greatest) { second = greatest; greatest = power; }
    else if (power >= second) second = power;
  }
  return second <= threshold;
}

static void smooth(std::vector<float>& gains, int bands) {
  if (!bands) return;
  std::vector<float> scratch(gains.size());
  for (auto& gain : gains) gain = std::log(gain);
  for (int index = 0; index < static_cast<int>(gains.size()); ++index) {
    const int first = std::max(0, index - bands), last = std::min(BINS - 1, index + bands);
    float sum = 0;
    for (int other = first; other <= last; ++other) sum = fr(sum + gains[other]);
    scratch[index] = fr(sum / (last - first + 1));
  }
  for (int index = 0; index < BINS; ++index) gains[index] = std::exp(scratch[index]);
}

class Transformer {
public:
  Transformer(bool profiling, const Profile* profile, Settings settings)
    : profiling(profiling), profile(profile), settings(settings), inWindow(hann()), outWindow(hann()) {
    double denominator = 0;
    for (int index = 0; index < N; index += STEP) denominator += inWindow[index] * outWindow[index];
    for (auto& value : inWindow) value = fr(value / denominator);
    const int sampleRate = 1000;
    attackBlocks = 1 + static_cast<int>(0.02 * sampleRate / STEP);
    releaseBlocks = 1 + static_cast<int>(0.1 * sampleRate / STEP);
    attenuation = db(profiling ? 0 : -settings.noiseGain);
    oneBlockAttack = db((profiling ? 0 : -settings.noiseGain) / attackBlocks);
    oneBlockRelease = db((profiling ? 0 : -settings.noiseGain) / releaseBlocks);
    const int history = profiling ? 1 : std::max(5, 2 + attackBlocks);
    queue = std::vector<Window>(history);
    for (auto& window : queue) std::fill(window.gains.begin(), window.gains.end(), attenuation);
    inputPosition = profiling ? 0 : N - STEP;
    outputStepCount = profiling ? 0 : -(history - 1) - 3;
    output.resize(100000);
  }

  std::vector<float> run(const std::vector<float>& input, Profile* gathered) {
    process(input.data(), input.size());
    if (!profiling) while (outputStepCount * STEP < inputSampleCount) process(nullptr, STEP);
    if (profiling) {
      gathered->windows = windows;
      gathered->means = sums;
      for (auto& mean : gathered->means) mean = fr(mean / windows);
    }
    output.resize(outputLength);
    output.resize(input.size());
    return output;
  }

private:
  bool profiling;
  const Profile* profile;
  Settings settings;
  std::vector<float> inWindow, outWindow, inputBuffer = std::vector<float>(N), overlap = std::vector<float>(N), output;
  std::vector<Window> queue;
  int attackBlocks, releaseBlocks;
  float attenuation, oneBlockAttack, oneBlockRelease;
  int inputPosition, outputStepCount, inputSampleCount = 0, outputLength = 0, windows = 0;
  std::vector<float> sums = std::vector<float>(BINS);

  int currentQueueSize() const {
    return std::max(0, std::min(static_cast<int>(queue.size()), outputStepCount + static_cast<int>(queue.size()) + (profiling ? 0 : 3)));
  }
  bool queueIsFull() const { return profiling ? outputStepCount >= 0 : outputStepCount >= -3; }

  void fillFirstWindow() {
    std::vector<std::complex<double>> values(N);
    for (int index = 0; index < N; ++index) values[index] = fr(inputBuffer[index] * inWindow[index]);
    fft(values, false);
    auto& record = queue[0];
    for (int band = 0; band < BINS; ++band) {
      record.real[band] = fr(values[band].real());
      record.imaginary[band] = fr(values[band].imag());
      record.spectrum[band] = fr(fr(record.real[band] * record.real[band]) + fr(record.imaginary[band] * record.imaginary[band]));
    }
  }

  void reduceNoise() {
    const int history = currentQueueSize(), count = std::min(5, history);
    std::fill(queue[0].gains.begin(), queue[0].gains.end(), attenuation);
    if (count > 2) {
      auto& gains = queue[2].gains;
      for (int band = 0; band < BINS; ++band) {
        if (!secondGreatest(queue, count, band, fr(settings.sensitivity * std::log(10.0)) * profile->means[band])) gains[band] = 1;
      }
    }
    for (int band = 0; band < BINS; ++band) {
      for (int index = 3; index < history; ++index) {
        const float minimum = std::max(attenuation, fr(queue[index - 1].gains[band] * oneBlockAttack));
        if (queue[index].gains[band] < minimum) queue[index].gains[band] = minimum;
        else break;
      }
    }
    for (int band = 0; band < BINS; ++band) {
      queue[1].gains[band] = std::max(queue[1].gains[band], std::max(attenuation, fr(queue[2].gains[band] * oneBlockRelease)));
    }
    if (!queueIsFull()) return;
    auto& record = queue[history - 1];
    smooth(record.gains, settings.smoothing);
    for (int band = 0; band < BINS; ++band) {
      const float gain = settings.residue ? fr(record.gains[band] - 1) : record.gains[band];
      record.real[band] = fr(record.real[band] * gain);
      record.imaginary[band] = fr(record.imaginary[band] * gain);
    }
  }

  void outputStep() {
    if (profiling || !queueIsFull()) return;
    const auto& record = queue.back();
    std::vector<std::complex<double>> values(N);
    for (int band = 0; band < BINS; ++band) {
      values[band] = { static_cast<double>(record.real[band]), static_cast<double>(record.imaginary[band]) };
      if (band && band < BINS - 1) values[N - band] = std::conj(values[band]);
    }
    fft(values, true);
    for (int index = 0; index < N; ++index) overlap[index] = fr(overlap[index] + fr(values[index].real() * outWindow[index]));
    if (outputStepCount >= 0) {
      std::copy(overlap.begin(), overlap.begin() + STEP, output.begin() + outputLength);
      outputLength += STEP;
    }
    std::move(overlap.begin() + STEP, overlap.end(), overlap.begin());
    std::fill(overlap.end() - STEP, overlap.end(), 0.0f);
  }

  void process(const float* source, int length) {
    if (source) inputSampleCount += length;
    int remaining = length, sourceOffset = 0;
    while (remaining > 0 && outputStepCount * STEP < inputSampleCount) {
      const int available = std::min(remaining, N - inputPosition);
      if (source) std::copy(source + sourceOffset, source + sourceOffset + available, inputBuffer.begin() + inputPosition);
      else std::fill(inputBuffer.begin() + inputPosition, inputBuffer.begin() + inputPosition + available, 0.0f);
      sourceOffset += available;
      remaining -= available;
      inputPosition += available;
      if (inputPosition != N) continue;
      fillFirstWindow();
      if (profiling) {
        ++windows;
        for (int band = 0; band < BINS; ++band) sums[band] = fr(sums[band] + queue[0].spectrum[band]);
      } else reduceNoise();
      outputStep();
      ++outputStepCount;
      if (queue.size() > 1) std::rotate(queue.begin(), queue.end() - 1, queue.end());
      std::move(inputBuffer.begin() + STEP, inputBuffer.end(), inputBuffer.begin());
      inputPosition -= STEP;
    }
  }
};

static std::vector<float> makeInput() {
  uint32_t state = 0x12345678;
  std::vector<float> result(4096);
  for (auto& value : result) {
    state = state * 1664525u + 1013904223u;
    value = fr((static_cast<double>(state) / 4294967296.0 - 0.5) * 0.08);
  }
  return result;
}

int main(int argc, char** argv) {
  if (argc != 2) { std::cerr << "usage: oracle OUTPUT.bin\n"; return 2; }
  const auto input = makeInput();
  const std::vector<float> profileInput(input.begin(), input.begin() + N);
  Profile profile;
  Transformer(true, nullptr, {}).run(profileInput, &profile);
  Settings reducedSettings;
  const auto reduced = Transformer(false, &profile, reducedSettings).run(input, nullptr);
  Settings residueSettings; residueSettings.residue = true;
  const auto residue = Transformer(false, &profile, residueSettings).run(input, nullptr);
  std::ofstream output(argv[1], std::ios::binary);
  output.write(reinterpret_cast<const char*>(profile.means.data()), profile.means.size() * sizeof(float));
  output.write(reinterpret_cast<const char*>(reduced.data()), reduced.size() * sizeof(float));
  output.write(reinterpret_cast<const char*>(residue.data()), residue.size() * sizeof(float));
  if (!output) return 1;
  std::cout << "profile_windows=" << profile.windows << " reduced_samples=" << reduced.size() << " residue_samples=" << residue.size() << "\n";
}
