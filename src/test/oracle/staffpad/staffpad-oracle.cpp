// Native Audacity 4.0.2 StaffPad oracle for the browser port.
// Build with scripts/verifyStaffPadOracle.py and an official Audacity source tree.
#include "StaffPadTimeAndPitch.h"
#include "AudioContainer.h"
#include "TimeAndPitchInterface.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

class RealSource final : public TimeAndPitchSource {
public:
  explicit RealSource(const std::vector<std::vector<float>>& input) : input_(input) {}
  void Pull(float* const* buffer, size_t samplesPerChannel) override {
    const auto frames = input_[0].size();
    const auto remaining = frames > position_ ? frames - position_ : 0u;
    const auto count = std::min(remaining, samplesPerChannel);
    for (size_t channel = 0; channel < input_.size(); ++channel) {
      std::copy_n(input_[channel].data() + position_, count, buffer[channel]);
      std::fill(buffer[channel] + count, buffer[channel] + samplesPerChannel, 0.f);
    }
    position_ += count;
  }
private:
  const std::vector<std::vector<float>>& input_;
  size_t position_ = 0;
};

int main(int argc, char** argv) {
  if (argc != 9) {
    std::cerr << "usage: oracle input.f32 output.f32 channels sampleRate timeRatio pitchRatio preserveFormants fftSize\n";
    return 2;
  }
  const std::string inputPath = argv[1];
  const std::string outputPath = argv[2];
  const int channels = std::stoi(argv[3]);
  const int sampleRate = std::stoi(argv[4]);
  const double timeRatio = std::stod(argv[5]);
  const double pitchRatio = std::stod(argv[6]);
  const bool preserveFormants = std::stoi(argv[7]) != 0;
  const int fftSize = std::stoi(argv[8]);
  if (channels < 1 || channels > 2 || sampleRate <= 0 || timeRatio <= 0 || pitchRatio <= 0) return 2;
  const int officialFftSize = 1 << ((preserveFormants ? 11 : 12)
    + static_cast<int>(std::round(std::log2(sampleRate / 44100.))));
  if (fftSize != officialFftSize) return 7;

  std::ifstream input(inputPath, std::ios::binary | std::ios::ate);
  if (!input) return 3;
  const auto byteCount = static_cast<size_t>(input.tellg());
  if (byteCount == 0 || byteCount % sizeof(float) != 0) return 4;
  std::vector<float> planar(byteCount / sizeof(float));
  input.seekg(0);
  input.read(reinterpret_cast<char*>(planar.data()), byteCount);
  input.close();
  if (planar.empty() || planar.size() % channels != 0) return 4;
  const size_t inputFrames = planar.size() / channels;
  std::vector<std::vector<float>> source(channels);
  for (int channel = 0; channel < channels; ++channel) {
    source[channel].assign(
      planar.begin() + channel * inputFrames,
      planar.begin() + (channel + 1) * inputFrames);
  }

  const size_t outputFrames = static_cast<size_t>(inputFrames * timeRatio + 0.5);
  AudioContainer container(static_cast<int>(outputFrames), channels);
  TimeAndPitchInterface::Parameters parameters;
  parameters.timeRatio = timeRatio;
  parameters.pitchRatio = pitchRatio;
  parameters.preserveFormants = preserveFormants;
  RealSource audioSource(source);
  StaffPadTimeAndPitch processor(sampleRate, channels, audioSource, parameters);
  size_t offset = 0;
  while (offset < outputFrames) {
    std::vector<float*> pointers(channels);
    for (int channel = 0; channel < channels; ++channel) {
      pointers[channel] = container.channelPointers[channel] + offset;
    }
    const size_t count = std::min(outputFrames - offset, static_cast<size_t>(1234));
    processor.GetSamples(pointers.data(), count);
    offset += count;
  }
  std::ofstream output(outputPath, std::ios::binary);
  if (!output) return 5;
  for (int channel = 0; channel < channels; ++channel) {
    output.write(
      reinterpret_cast<const char*>(container.channelVectors[channel].data()),
      outputFrames * sizeof(float));
  }
  return output ? 0 : 6;
}
