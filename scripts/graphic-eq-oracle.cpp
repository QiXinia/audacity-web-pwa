// Independent Audacity Graphic EQ reference fixture generator.
// Uses direct symmetric DFT and direct linear convolution, not Audacity's FFT or
// the TypeScript implementation. Frozen float PCM is consumed by Vitest.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

constexpr int WINDOW = 16384;
constexpr int TAPS = 8191;
constexpr int BANDS = 31;
constexpr double PI = 3.141592653589793238462643383279502884;
constexpr std::array<double, BANDS> FREQUENCIES{
    20.,25.,31.,40.,50.,63.,80.,100.,125.,160.,200.,
    250.,315.,400.,500.,630.,800.,1000.,1250.,1600.,2000.,
    2500.,3150.,4000.,5000.,6300.,8000.,10000.,12500.,16000.,20000.,
};
using Gains = std::array<double, BANDS>;
using Channels = std::vector<std::vector<float>>;
struct Case { std::uint32_t rate; Gains gains; Channels input, output; std::vector<float> impulse; };
struct Layout { int count; double hi; std::vector<double> positions; };

Layout layout(double rate) {
    const double hi = rate / 2, loLog = std::log10(20.0), denominator = std::log10(hi) - loLog;
    Layout result{0, hi, {}};
    for (double frequency : FREQUENCIES) {
        if (frequency > hi) break;
        result.positions.push_back(frequency == 20.0 ? 0.0 : (std::log10(frequency) - loLog) / denominator);
    }
    result.count = int(result.positions.size());
    if (result.count < 2) throw std::runtime_error("at least two bands required");
    return result;
}

double bspline(const Gains& gains, const Layout& layout, double when) {
    int minF = 0;
    while (minF < layout.count && layout.positions[minF] <= when) ++minF;
    --minF;
    if (minF < 0) {
        const double span = layout.positions[1] - layout.positions[0], s = (when - layout.positions[0]) / span;
        if (s < -1.5) return 0;
        if (s < -0.5) return gains[0] * std::pow(s + 1.5, 2) / 2;
        return gains[0] * (.75 - s*s) + gains[1] * std::pow(s + .5, 2) / 2;
    }
    if (minF >= layout.count - 1 && when >= layout.positions[layout.count - 1]) {
        const int last = layout.count - 1;
        const double span = layout.positions[last] - layout.positions[last - 1];
        const double s = (when - layout.positions[last]) / span;
        if (s > 1.5) return 0;
        if (s > .5) return gains[last] * std::pow(s - 1.5, 2) / 2;
        return gains[last] * (.75 - s*s) + gains[last - 1] * std::pow(s - .5, 2) / 2;
    }
    const double span = layout.positions[minF + 1] - layout.positions[minF];
    const double s = (when - layout.positions[minF]) / span;
    double value;
    if (s < .5) {
        value = gains[minF] * (.75 - s*s);
        if (minF + 1 < layout.count) value += gains[minF + 1] * std::pow(s + .5, 2) / 2;
        if (minF - 1 >= 0) value += gains[minF - 1] * std::pow(s - .5, 2) / 2;
    } else {
        value = gains[minF] * std::pow(s - 1.5, 2) / 2;
        if (minF + 1 < layout.count) value += gains[minF + 1] * (.75 - std::pow(1. - s, 2));
        if (minF + 2 < layout.count) value += gains[minF + 2] * std::pow(s - .5, 2) / 2;
    }
    return value;
}

double envelope(const Gains& gains, const Layout& layout, double frequency) {
    double when;
    if (frequency <= 20) when = 0;
    else if (frequency >= layout.hi) when = 1;
    else when = (std::log10(frequency) - std::log10(20.0)) / (std::log10(layout.hi) - std::log10(20.0));
    return bspline(gains, layout, when);
}

std::vector<double> impulse(const Case& item) {
    const auto bands = layout(item.rate);
    std::vector<double> spectrum(WINDOW + 1);
    const int half = WINDOW / 2;
    const double delta = item.rate / 2.0 / half;
    for (int index = 0; index <= half; ++index) {
        spectrum[index] = std::pow(10.0, envelope(item.gains, bands, index * delta) / 20.0);
    }
    std::vector<double> time(WINDOW);
    for (int n = 0; n < WINDOW; ++n) {
        double sum = spectrum[0] + spectrum[half] * std::cos(PI * n);
        for (int k = 1; k < half; ++k) sum += 2 * spectrum[k] * std::cos(2 * PI * k * n / WINDOW);
        time[n] = sum / WINDOW;
    }
    constexpr int centre = (TAPS - 1) / 2;
    int index = 0;
    for (; index <= centre; ++index) {
        const double multiplier = .42 - .5 * std::cos(2 * PI * (index + centre) / (TAPS - 1))
            + .08 * std::cos(4 * PI * (index + centre) / (TAPS - 1));
        time[index] *= multiplier;
        if (index != 0) time[WINDOW - index] *= multiplier;
    }
    for (; index <= half; ++index) time[index] = time[WINDOW - index] = 0;
    std::vector<double> result(TAPS);
    for (int tap = 0; tap < centre; ++tap) {
        result[centre + tap] = time[tap];
        result[tap] = time[WINDOW - centre + tap];
    }
    result[TAPS - 1] = time[centre];
    return result;
}

Case makeCase(std::uint32_t rate, Gains gains, Channels input) {
    Case item{rate, gains, input, input, {}};
    const auto h = impulse(item);
    item.impulse.reserve(h.size());
    for (double value : h) item.impulse.push_back(float(value));
    constexpr int centre = (TAPS - 1) / 2;
    for (std::size_t channel = 0; channel < input.size(); ++channel) {
        for (std::size_t n = 0; n < input[channel].size(); ++n) {
            double sum = 0;
            for (int tap = 0; tap < TAPS; ++tap) {
                const long source = long(n) + centre - tap;
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
        value = float((double(state) / 4294967296.0 - .5) * amplitude);
    }
    return result;
}

template<typename T> void write(std::ofstream& out, const T& value) {
    out.write(reinterpret_cast<const char*>(&value), sizeof(T));
}

int main(int argc, char** argv) {
    if (argc != 2) { std::cerr << "usage: graphic-eq-oracle OUTPUT\n"; return 2; }
    Gains multi{}, nyquist{}, lowRate{}, single{};
    multi[7] = 6; multi[17] = -3; multi[23] = 9; multi[30] = -6;
    nyquist[0] = -6; nyquist[23] = 12;
    lowRate[7] = -4; lowRate[13] = 8;
    single[17] = 12;
    const std::vector<Case> cases{
        makeCase(44100, multi, {noise(8300, 0x12345678, .18f), noise(8300, 0x87654321, .09f)}),
        makeCase(8000, nyquist, {noise(257, 0x10203040, .2f)}),
        makeCase(1000, lowRate, {noise(80, 0x778899aa, .12f)}),
        makeCase(44100, single, {noise(33, 0xabcdef01, .14f)}),
    };
    std::ofstream out(argv[1], std::ios::binary);
    out.write("GEQ1", 4);
    write<std::uint32_t>(out, cases.size());
    for (const auto& item : cases) {
        write(out, item.rate);
        write<std::uint32_t>(out, item.input.size());
        write<std::uint32_t>(out, item.input[0].size());
        for (double gain : item.gains) write(out, gain);
        for (float value : item.impulse) write(out, value);
        for (const auto& channel : item.input) for (float value : channel) write(out, value);
        for (const auto& channel : item.output) for (float value : channel) write(out, value);
    }
    std::cout << cases.size() << " Graphic EQ oracle cases written\n";
}
