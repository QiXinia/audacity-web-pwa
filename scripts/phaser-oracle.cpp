// Independent Audacity 4.0.2 PhaserBase reference fixture generator.
// This file directly implements the upstream C++ recurrence and does not share
// code with the TypeScript DSP. Frozen float PCM is consumed by Vitest.
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

constexpr double PI = 3.141592653589793238462643383279502884;
constexpr int MAX_STAGES = 24;
constexpr int LFO_SKIP = 20;

struct Settings {
    int stages;
    int dryWet;
    double frequency;
    double phase;
    int depth;
    int feedback;
    double outGain;
};
struct State {
    std::array<double, MAX_STAGES> old{};
    std::uint64_t skipCount = 0;
    double gain = 0;
    double feedbackOut = 0;
    int lastStages = 0;
};
struct Case {
    std::uint32_t rate;
    Settings settings;
    std::uint32_t splitAt;
    std::vector<std::vector<float>> input;
    std::vector<std::vector<float>> output;
};

void processBlock(const Settings& raw, float sampleRate, const std::vector<float>& input,
                  std::size_t begin, std::size_t end, State& state,
                  std::vector<float>& output) {
    const int stages = raw.stages & ~1;
    for (int stage = state.lastStages; stage < stages; ++stage) state.old[stage] = 0;
    state.lastStages = stages;
    const double lfoSkip = raw.frequency * 2 * PI / sampleRate;
    const double phase = raw.phase * PI / 180;
    const double outGain = std::pow(10.0, raw.outGain / 20);
    for (std::size_t index = begin; index < end; ++index) {
        const double dry = input[index];
        double wet = dry + state.feedbackOut * raw.feedback / 101.0;
        if ((state.skipCount++) % LFO_SKIP == 0) {
            double gain = (1.0 + std::cos(double(state.skipCount) * lfoSkip + phase)) / 2.0;
            gain = std::expm1(gain * 4.0) / std::expm1(4.0);
            state.gain = 1.0 - gain / 255.0 * raw.depth;
        }
        for (int stage = 0; stage < stages; ++stage) {
            const double previous = state.old[stage];
            state.old[stage] = state.gain * previous + wet;
            wet = previous - state.gain * state.old[stage];
        }
        state.feedbackOut = wet;
        output[index] = float(outGain * (wet * raw.dryWet + dry * (255 - raw.dryWet)) / 255.0);
    }
}

Case makeCase(std::uint32_t rate, Settings settings, std::uint32_t splitAt,
              std::vector<std::vector<float>> input) {
    Case item{rate, settings, splitAt, input, input};
    for (std::size_t channel = 0; channel < input.size(); ++channel) {
        State state;
        const auto samples = input[channel].size();
        const auto firstEnd = std::min<std::size_t>(splitAt, samples);
        processBlock(settings, float(rate), input[channel], 0, firstEnd, state, item.output[channel]);
        processBlock(settings, float(rate), input[channel], firstEnd, samples, state, item.output[channel]);
    }
    return item;
}

std::vector<float> noise(std::size_t length, std::uint32_t state, float amplitude) {
    std::vector<float> result(length);
    for (std::size_t index = 0; index < length; ++index) {
        state = state * 1664525u + 1013904223u;
        const double random = double(state) / 4294967296.0 - 0.5;
        result[index] = float((random + (index % 37 == 0 ? 0.4 : 0.0)) * amplitude);
    }
    return result;
}

template<typename T> void write(std::ofstream& out, const T& value) {
    out.write(reinterpret_cast<const char*>(&value), sizeof(T));
}

int main(int argc, char** argv) {
    if (argc != 2) { std::cerr << "usage: phaser-oracle OUTPUT\n"; return 2; }
    const std::vector<Case> cases{
        makeCase(1000, {4, 180, 1.25, 45, 210, 70, -3}, 17,
                 {noise(137, 0x12345678, .6f), noise(137, 0x87654321, .3f)}),
        makeCase(44100, {24, 255, 4, 360, 255, -95, 6}, 83,
                 {noise(257, 0x10203040, .12f)}),
        makeCase(8000, {3, 64, .001, 180, 0, 0, 0}, 20,
                 {noise(65, 0x778899aa, .5f), noise(65, 0xaabbccdd, .2f)}),
        makeCase(48000, {8, 128, 2.5, 270, 180, 95, -12}, 21,
                 {noise(333, 0xabcdef01, .08f), noise(333, 0x13579bdf, .05f)}),
    };
    std::ofstream out(argv[1], std::ios::binary);
    out.write("PHS1", 4);
    write<std::uint32_t>(out, cases.size());
    for (const auto& item : cases) {
        write(out, item.rate);
        write<std::uint32_t>(out, item.input.size());
        write<std::uint32_t>(out, item.input[0].size());
        write(out, item.splitAt);
        write<std::int32_t>(out, item.settings.stages);
        write<std::int32_t>(out, item.settings.dryWet);
        write<std::int32_t>(out, item.settings.depth);
        write<std::int32_t>(out, item.settings.feedback);
        write(out, item.settings.frequency);
        write(out, item.settings.phase);
        write(out, item.settings.outGain);
        for (const auto& channel : item.input) for (float value : channel) write(out, value);
        for (const auto& channel : item.output) for (float value : channel) write(out, value);
    }
    std::cout << cases.size() << " Phaser oracle cases written\n";
}
