// Independent Audacity Filter Curve EQ reference fixture generator.
// Uses direct symmetric DFT and direct linear convolution, not Audacity's FFT or
// the TypeScript implementation. Frozen float PCM is consumed by Vitest.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <utility>
#include <vector>

constexpr int WINDOW = 16384;
constexpr double PI = 3.141592653589793238462643383279502884;
using Channels = std::vector<std::vector<float>>;
using Point = std::pair<double, double>;

struct Case {
    std::uint32_t rate, linear, taps;
    std::vector<Point> points;
    Channels input, output;
    std::vector<float> impulse;
};

double envelope(const std::vector<Point>& original, double frequency, double rate, bool linear) {
    if (original.empty()) return 0;
    std::vector<Point> points = original;
    std::sort(points.begin(), points.end());
    const double hi = rate / 2;
    const double clamped = linear ? std::max(0.0, std::min(hi, frequency))
                                  : std::max(20.0, std::min(hi, frequency));
    const double x = linear ? clamped : std::log10(clamped);
    auto coordinate = [&](const Point& point) {
        return linear ? point.first : std::log10(point.first);
    };
    if (x <= coordinate(points.front())) return points.front().second;
    if (x >= coordinate(points.back())) return points.back().second;
    for (std::size_t index = 1; index < points.size(); ++index) {
        const double nextX = coordinate(points[index]);
        if (x > nextX) continue;
        const double previousX = coordinate(points[index - 1]);
        const double dt = nextX - previousX;
        const double to = x - previousX;
        return (points[index - 1].second * (dt - to) + points[index].second * to) / dt;
    }
    return points.back().second;
}

std::vector<double> impulse(const Case& item) {
    std::vector<double> spectrum(WINDOW + 1);
    const int half = WINDOW / 2;
    const double delta = item.rate / 2.0 / half;
    for (int index = 0; index <= half; ++index) {
        const double frequency = index * delta;
        const double db = envelope(item.points, frequency, item.rate, item.linear != 0);
        spectrum[index] = std::pow(10.0, db / 20.0);
    }
    std::vector<double> time(WINDOW);
    // Direct inverse DFT of a real conjugate-symmetric spectrum.
    for (int n = 0; n < WINDOW; ++n) {
        double sum = spectrum[0] + spectrum[half] * std::cos(PI * n);
        for (int k = 1; k < half; ++k) sum += 2 * spectrum[k] * std::cos(2 * PI * k * n / WINDOW);
        time[n] = sum / WINDOW;
    }
    const int M = int(item.taps), centre = (M - 1) / 2;
    int index = 0;
    for (; index <= centre; ++index) {
        const double multiplier = 0.42
            - 0.5 * std::cos(2 * PI * (index + centre) / (M - 1))
            + 0.08 * std::cos(4 * PI * (index + centre) / (M - 1));
        time[index] *= multiplier;
        if (index != 0) time[WINDOW - index] *= multiplier;
    }
    for (; index <= half; ++index) time[index] = time[WINDOW - index] = 0;
    std::vector<double> result(M);
    for (int tap = 0; tap < centre; ++tap) {
        result[centre + tap] = time[tap];
        result[tap] = time[WINDOW - centre + tap];
    }
    result[M - 1] = time[centre];
    return result;
}

Case makeCase(std::uint32_t rate, bool linear, std::uint32_t taps,
              std::vector<Point> points, Channels input) {
    Case item{rate, linear ? 1u : 0u, taps, std::move(points), input, input, {}};
    const auto h = impulse(item);
    item.impulse.reserve(h.size());
    for (double value : h) item.impulse.push_back(float(value));
    const int centre = (int(taps) - 1) / 2;
    for (std::size_t channel = 0; channel < input.size(); ++channel) {
        for (std::size_t n = 0; n < input[channel].size(); ++n) {
            double sum = 0;
            for (std::size_t tap = 0; tap < taps; ++tap) {
                const long source = long(n) + centre - long(tap);
                if (source >= 0 && source < long(input[channel].size())) sum += h[tap] * input[channel][source];
            }
            item.output[channel][n] = float(sum);
        }
    }
    return item;
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
    if (argc != 2) { std::cerr << "usage: filter-curve-oracle OUTPUT\n"; return 2; }
    const std::vector<Case> cases{
        makeCase(8000, false, 8191, {{1000, 6}},
                 {noise(8300, 0x12345678, 0.18f), noise(8300, 0x87654321, 0.09f)}),
        makeCase(8000, false, 127, {{10, -6}, {100, 12}, {1000, -3}, {5000, 9}},
                 {noise(257, 0x10203040, 0.2f)}),
        makeCase(44100, true, 63, {{50, -12}, {1000, 6}, {20000, -3}, {48000, 12}},
                 {noise(193, 0x33445566, 0.16f)}),
        makeCase(48000, false, 21, {{5, -12}, {15, 6}}, {noise(80, 0x778899aa, 0.12f)}),
        makeCase(8000, false, 8191, {{20, 0}, {1000, 0}}, {noise(33, 0xabcdef01, 0.14f)}),
        makeCase(44100, false, 255, {{100, 9}, {500, 0}}, {noise(1000, 0x55aa33cc, 0.1f)}),
    };
    std::ofstream out(argv[1], std::ios::binary);
    out.write("FCQ1", 4);
    write<std::uint32_t>(out, cases.size());
    for (const auto& item : cases) {
        write(out, item.rate);
        write<std::uint32_t>(out, item.input.size());
        write<std::uint32_t>(out, item.input[0].size());
        write(out, item.linear); write(out, item.taps);
        write<std::uint32_t>(out, item.points.size());
        for (const auto& point : item.points) { write(out, point.first); write(out, point.second); }
        for (const float value : item.impulse) write(out, value);
        for (const auto& channel : item.input) for (float value : channel) write(out, value);
        for (const auto& channel : item.output) for (float value : channel) write(out, value);
    }
    std::cout << cases.size() << " Filter Curve EQ oracle cases written\n";
}
