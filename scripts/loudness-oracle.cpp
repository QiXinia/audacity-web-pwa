// Independent Audacity 4.0.2 Loudness / EBU R128 fixture generator.
// The TypeScript oracle test never executes this code at test time; it compares
// against the frozen PCM emitted here, so DSP and normalization regressions are visible.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

constexpr std::size_t HIST_BIN_COUNT = 65536;
constexpr double GAMMA_A = (-70.0 + 0.691) / 10.0;
constexpr double EBU_SCALE = 0.8529037031;

struct Biquad {
    double b0{}, b1{}, b2{}, a1{}, a2{};
    double x1{}, x2{}, y1{}, y2{};
    float process(float input) {
        const double output = double(input) * b0 + x1 * b1 + x2 * b2 - y1 * a1 - y2 * a2;
        x2 = x1; x1 = input; y2 = y1; y1 = output;
        return float(output);
    }
};

std::array<Biquad, 2> filters(double fs) {
    const double db = 3.999843853973347, f0 = 1681.974450955533, q = 0.7071752369554196;
    const double k = std::tan(M_PI * f0 / fs), vh = std::pow(10.0, db / 20.0);
    const double vb = std::pow(vh, 0.4996667741545416), a0 = 1.0 + k / q + k * k;
    Biquad shelf;
    shelf.b0 = (vh + vb * k / q + k * k) / a0;
    shelf.b1 = 2.0 * (k * k - vh) / a0;
    shelf.b2 = (vh - vb * k / q + k * k) / a0;
    shelf.a1 = 2.0 * (k * k - 1.0) / a0;
    shelf.a2 = (1.0 - k / q + k * k) / a0;
    const double hf0 = 38.13547087602444, hq = 0.5003270373238773;
    const double hk = std::tan(M_PI * hf0 / fs), ha0 = 1.0 + hk / hq + hk * hk;
    Biquad high;
    high.b0 = 1.0; high.b1 = -2.0; high.b2 = 1.0;
    high.a1 = 2.0 * (hk * hk - 1.0) / ha0;
    high.a2 = (1.0 - hk / hq + hk * hk) / ha0;
    return {shelf, high};
}

class EbuR128 {
public:
    EbuR128(double rate, std::size_t channels)
        : blockSize_(std::size_t(std::ceil(0.4 * rate))), blockStep_(std::size_t(std::ceil(0.1 * rate))),
          ring_(blockSize_), histogram_(HIST_BIN_COUNT) {
        for (std::size_t channel = 0; channel < channels; ++channel) filters_.push_back(filters(rate));
    }
    void sample(const std::vector<float>& values) {
        for (std::size_t channel = 0; channel < values.size(); ++channel) {
            const float shelf = filters_[channel][0].process(values[channel]);
            const double weighted = filters_[channel][1].process(shelf);
            if (channel == 0) ring_[ringPosition_] = weighted * weighted;
            else ring_[ringPosition_] += weighted * weighted;
        }
        ++ringPosition_; ++ringSize_;
        if (ringPosition_ % blockStep_ == 0 && ringSize_ >= blockSize_) addBlock(blockSize_);
        if (ringPosition_ == blockSize_) ringPosition_ = 0;
    }
    double integrated() {
        double sum = 0; long count = 0; sums(0, sum, count);
        if (count == 0) { addBlock(ringSize_); sums(0, sum, count); }
        if (count == 0) return 0;
        const double gammaR = std::log10(sum / count) - 1;
        const long indexR = std::lround((gammaR - GAMMA_A) * double(HIST_BIN_COUNT) / -GAMMA_A - 1);
        sums(indexR + 1, sum, count);
        return count == 0 ? 0 : EBU_SCALE * sum / count;
    }
private:
    void addBlock(std::size_t validLength) {
        ringSize_ = blockSize_;
        double value = 0;
        for (std::size_t index = 0; index < validLength; ++index) value += ring_[index];
        const double logarithmic = std::log10(value / double(validLength));
        if (!std::isfinite(logarithmic)) return;
        const long index = std::lround((logarithmic - GAMMA_A) * double(HIST_BIN_COUNT) / -GAMMA_A - 1);
        if (index >= 0 && index < long(HIST_BIN_COUNT)) ++histogram_[std::size_t(index)];
    }
    void sums(long start, double& sum, long& count) const {
        sum = 0; count = 0;
        for (long index = std::max(0L, start); index < long(HIST_BIN_COUNT); ++index) {
            const double value = -GAMMA_A / double(HIST_BIN_COUNT) * (index + 1) + GAMMA_A;
            sum += std::pow(10.0, value) * histogram_[std::size_t(index)];
            count += histogram_[std::size_t(index)];
        }
    }
    std::size_t blockSize_, blockStep_, ringPosition_{}, ringSize_{};
    std::vector<double> ring_;
    std::vector<unsigned long> histogram_;
    std::vector<std::array<Biquad, 2>> filters_;
};

using Channels = std::vector<std::vector<float>>;

float ebu(const Channels& input, double rate) {
    EbuR128 processor(rate, input.size());
    for (std::size_t index = 0; index < input[0].size(); ++index) {
        std::vector<float> values;
        for (const auto& channel : input) values.push_back(channel[index]);
        processor.sample(values);
    }
    return float(processor.integrated());
}

float rms(const std::vector<float>& input) {
    double sum = 0;
    for (const float value : input) sum += double(value) * value;
    return float(std::sqrt(sum / input.size()));
}

struct Case {
    std::uint32_t rate, algorithm, independent, dualMono;
    double target;
    Channels input, output;
    std::vector<float> gains;
};

Case makeCase(std::uint32_t rate, std::uint32_t algorithm, std::uint32_t independent,
              std::uint32_t dualMono, double target, Channels input) {
    Case result{rate, algorithm, independent, dualMono, target, input, input, {}};
    const bool mono = input.size() == 1;
    auto loudnessGain = [&](float extent) {
        if (extent == 0) throw std::runtime_error("silent");
        float multiplier = float(float(std::pow(10.0, target / 10.0)) / extent);
        if (dualMono || !mono) multiplier = float(multiplier / 2.0f);
        return float(std::sqrt(multiplier));
    };
    if (algorithm == 0 && independent) {
        for (const auto& channel : input) result.gains.push_back(loudnessGain(ebu({channel}, rate)));
    } else if (algorithm == 0) {
        const float extent = ebu(input, rate);
        float multiplier = float(float(std::pow(10.0, target / 10.0)) / extent);
        if (mono && dualMono) multiplier = float(multiplier / 2.0f);
        result.gains.assign(input.size(), float(std::sqrt(multiplier)));
    } else if (independent) {
        const float ratio = float(std::pow(10.0, target / 20.0));
        for (const auto& channel : input) result.gains.push_back(float(ratio / rms(channel)));
    } else {
        const float ratio = float(std::pow(10.0, target / 20.0));
        float extent = rms(input[0]);
        if (input.size() == 2) {
            const float right = rms(input[1]);
            extent = float(std::sqrt((extent * extent + right * right) / 2.0));
        }
        result.gains.assign(input.size(), float(ratio / extent));
    }
    for (std::size_t channel = 0; channel < input.size(); ++channel) {
        for (std::size_t index = 0; index < input[channel].size(); ++index) {
            result.output[channel][index] = float(input[channel][index] * result.gains[channel]);
        }
    }
    return result;
}

std::vector<float> noise(std::size_t length, std::uint32_t state, float amplitude) {
    std::vector<float> result(length);
    for (auto& value : result) {
        state = state * 1664525u + 1013904223u;
        value = float((double(state) / 4294967296.0 - 0.5) * amplitude);
    }
    return result;
}

template<typename T> void write(std::ofstream& out, const T& value) {
    out.write(reinterpret_cast<const char*>(&value), sizeof(T));
}

int main(int argc, char** argv) {
    if (argc != 2) { std::cerr << "usage: loudness-oracle OUTPUT\n"; return 2; }
    const auto left = noise(16000, 0x12345678, 0.16f);
    const auto right = noise(16000, 0x87654321, 0.08f);
    const auto shortInput = noise(2800, 0x10203040, 0.2f);
    const auto longLeft = noise(44100, 0x33445566, 0.12f);
    const auto longRight = noise(44100, 0x778899aa, 0.06f);
    const std::vector<Case> cases{
        makeCase(8000, 0, 0, 1, -23, {left, right}),
        makeCase(8000, 0, 1, 0, -23, {left, right}),
        makeCase(8000, 0, 0, 1, -26, {left}),
        makeCase(8000, 0, 1, 0, -26, {left}),
        makeCase(8000, 1, 0, 1, -20, {left, right}),
        makeCase(8000, 1, 1, 0, -20, {left, right}),
        makeCase(8000, 0, 0, 0, -24, {shortInput}),
        makeCase(44100, 0, 0, 1, -18, {longLeft, longRight}),
    };
    std::ofstream out(argv[1], std::ios::binary);
    out.write("LDU1", 4);
    write<std::uint32_t>(out, cases.size());
    for (const auto& item : cases) {
        write(out, item.rate);
        write<std::uint32_t>(out, item.input.size());
        write<std::uint32_t>(out, item.input[0].size());
        write(out, item.algorithm); write(out, item.independent); write(out, item.dualMono);
        write(out, item.target);
        for (const float gain : item.gains) write(out, gain);
        for (const auto& channel : item.input) for (const float value : channel) write(out, value);
        for (const auto& channel : item.output) for (const float value : channel) write(out, value);
    }
    std::cout << cases.size() << " Loudness oracle cases written\n";
}
