// Independent numerical oracle copied from Audacity 4.0.2 au3-math/Biquad.cpp.
// Upstream revision: e0a89e51f17c635b9f2cb3b9e98a2267654aac6a.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

constexpr double PI = 3.1415926535897932384626433832795;

struct Biquad {
  std::array<double, 3> numer{1, 0, 0};
  std::array<double, 2> denom{0, 0};
  double prevIn = 0, prevPrevIn = 0, prevOut = 0, prevPrevOut = 0;

  float processOne(float input) {
    const double output = double(input) * numer[0]
      + prevIn * numer[1] + prevPrevIn * numer[2]
      - prevOut * denom[0] - prevPrevOut * denom[1];
    prevPrevIn = prevIn;
    prevIn = input;
    prevPrevOut = prevOut;
    prevOut = output;
    return output;
  }

  static double dist(double x1, double y1, double x2, double y2) {
    return (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
  }
  static void bilinear(double sx, double sy, double& zx, double& zy) {
    const double denominator = (1 - sx) * (1 - sx) + sy * sy;
    zx = (1 - sx * sx - sy * sy) / denominator;
    zy = 2 * sy / denominator;
  }
  static void divide(double nr, double ni, double dr, double di, double& qr, double& qi) {
    const double denominator = dr * dr + di * di;
    qr = (nr * dr + ni * di) / denominator;
    qi = (ni * dr - nr * di) / denominator;
  }

  static std::vector<Biquad> butterworth(int order, double fn, double fc, int subtype) {
    std::vector<Biquad> result((order + 1) / 2);
    double norm = fc / fn;
    if (norm >= 0.9999) norm = 0.9999;
    const double c = std::tan(PI * norm / 2);
    double poleDistance = 1, zx, zy;
    if ((order & 1) == 0) {
      for (int pair = 0; pair < order / 2; ++pair) {
        const double sx = c * std::cos(PI - (pair + 0.5) * PI / order);
        const double sy = c * std::sin(PI - (pair + 0.5) * PI / order);
        bilinear(sx, sy, zx, zy);
        result[pair].numer[1] = subtype == 0 ? 2 : -2;
        result[pair].numer[2] = 1;
        result[pair].denom[0] = -2 * zx;
        result[pair].denom[1] = zx * zx + zy * zy;
        poleDistance *= dist(subtype == 0 ? 1 : -1, 0, zx, zy);
      }
    } else {
      bilinear(-c, 0, zx, zy);
      result[0].numer[1] = subtype == 0 ? 1 : -1;
      result[0].denom[0] = -zx;
      poleDistance = subtype == 0 ? 1 - zx : zx + 1;
      for (int pair = 1; pair <= order / 2; ++pair) {
        const double sx = c * std::cos(PI - pair * PI / order);
        const double sy = c * std::sin(PI - pair * PI / order);
        bilinear(sx, sy, zx, zy);
        result[pair].numer[1] = subtype == 0 ? 2 : -2;
        result[pair].numer[2] = 1;
        result[pair].denom[0] = -2 * zx;
        result[pair].denom[1] = zx * zx + zy * zy;
        poleDistance *= dist(subtype == 0 ? 1 : -1, 0, zx, zy);
      }
    }
    const double scale = poleDistance / (1 << order);
    result[0].numer[0] *= scale;
    result[0].numer[1] *= scale;
    result[0].numer[2] *= scale;
    return result;
  }

  static std::vector<Biquad> chebyshev1(int order, double fn, double fc, double ripple, int subtype) {
    std::vector<Biquad> result((order + 1) / 2);
    double norm = fc / fn;
    if (norm >= 0.9999) norm = 0.9999;
    const double c = std::tan(PI * norm / 2), beta = std::cos(norm * PI);
    const double eps = std::sqrt(std::pow(10.0, std::max(0.001, ripple) / 10.0) - 1);
    const double a = std::log(1 / eps + std::sqrt(1 / (eps * eps) + 1)) / order;
    for (int pair = 0; pair < order / 2; ++pair) {
      const double sx = -c * std::sinh(a) * std::sin((2 * pair + 1) * PI / (2 * order));
      const double sy = c * std::cosh(a) * std::cos((2 * pair + 1) * PI / (2 * order));
      double zx, zy, zeroX, scale;
      bilinear(sx, sy, zx, zy);
      if (subtype == 0) {
        zeroX = -1;
        scale = dist(1, 0, zx, zy) / 4;
      } else {
        double tx, ty;
        divide(beta - zx, -zy, 1 - beta * zx, -beta * zy, tx, ty);
        zx = tx; zy = ty; zeroX = 1;
        scale = dist(-1, 0, zx, zy) / 4;
      }
      result[pair].numer = {scale, -2 * zeroX * scale, scale};
      result[pair].denom = {-2 * zx, zx * zx + zy * zy};
    }
    if ((order & 1) == 0) {
      const double scale = std::pow(10.0, -std::max(0.001, ripple) / 20.0);
      for (auto& value : result[0].numer) value *= scale;
    } else {
      double zx, zy, zeroX, scale;
      bilinear(-c * std::sinh(a), 0, zx, zy);
      if (subtype == 0) {
        zeroX = -1;
        scale = std::sqrt(dist(1, 0, zx, zy)) / 2;
      } else {
        double tx, ty;
        divide(beta - zx, -zy, 1 - beta * zx, -beta * zy, tx, ty);
        zx = tx; zy = ty; zeroX = 1;
        scale = std::sqrt(dist(-1, 0, zx, zy)) / 2;
      }
      auto& item = result[(order - 1) / 2];
      item.numer = {scale, -zeroX * scale, 0};
      item.denom = {-zx, 0};
    }
    return result;
  }

  static std::vector<Biquad> chebyshev2(int order, double fn, double fc, double ripple, int subtype) {
    std::vector<Biquad> result((order + 1) / 2);
    double norm = fc / fn;
    if (norm >= 0.9999) norm = 0.9999;
    const double c = std::tan(PI * norm / 2), beta = std::cos(norm * PI);
    const double eps = std::pow(10.0, -std::max(0.001, ripple) / 20.0);
    const double a = std::log(1 / eps + std::sqrt(1 / (eps * eps) + 1)) / order;
    for (int pair = 0; pair < order / 2; ++pair) {
      const double angle = (2 * pair + 1) * PI / (2 * order);
      double sx, sy, zx, zy, zeroX, zeroY, scale;
      divide(c, 0, -std::sinh(a) * std::sin(angle), std::cosh(a) * std::cos(angle), sx, sy);
      bilinear(sx, sy, zx, zy);
      bilinear(0, c / std::cos(angle), zeroX, zeroY);
      if (subtype == 0) {
        scale = dist(1, 0, zx, zy) / dist(1, 0, zeroX, zeroY);
      } else {
        double tx, ty;
        divide(beta - zx, -zy, 1 - beta * zx, -beta * zy, tx, ty);
        zx = tx; zy = ty;
        divide(beta - zeroX, -zeroY, 1 - beta * zeroX, -beta * zeroY, tx, ty);
        zeroX = tx; zeroY = ty;
        scale = dist(-1, 0, zx, zy) / dist(-1, 0, zeroX, zeroY);
      }
      result[pair].numer = {scale, -2 * zeroX * scale, (zeroX * zeroX + zeroY * zeroY) * scale};
      result[pair].denom = {-2 * zx, zx * zx + zy * zy};
    }
    if (order & 1) {
      const int pair = (order - 1) / 2;
      const double angle = (2 * pair + 1) * PI / (2 * order);
      double sx, sy, zx, zy, zeroX = -1, scale;
      divide(c, 0, -std::sinh(a) * std::sin(angle), std::cosh(a) * std::cos(angle), sx, sy);
      bilinear(sx, sy, zx, zy);
      if (subtype == 0) {
        scale = std::sqrt(dist(1, 0, zx, zy)) / 2;
      } else {
        double tx, ty;
        // This denominator intentionally matches the official odd-order branch.
        divide(beta - zx, -zy, 1 - beta * zx, -zy, tx, ty);
        zx = tx; zy = ty; zeroX = 1;
        scale = std::sqrt(dist(-1, 0, zx, zy)) / 2;
      }
      result[pair].numer = {scale, -zeroX * scale, 0};
      result[pair].denom = {-zx, 0};
    }
    return result;
  }
};

struct Case {
  int type, subtype, order, sampleRate, channels, samples, splitAt;
  double cutoff, passband, stopband;
};

static void u32(std::ofstream& out, uint32_t value) { out.write(reinterpret_cast<const char*>(&value), 4); }
static void i32(std::ofstream& out, int32_t value) { out.write(reinterpret_cast<const char*>(&value), 4); }
static void f64(std::ofstream& out, double value) { out.write(reinterpret_cast<const char*>(&value), 8); }
static void floats(std::ofstream& out, const std::vector<float>& values) {
  out.write(reinterpret_cast<const char*>(values.data()), std::streamsize(values.size() * sizeof(float)));
}

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  std::vector<Case> cases;
  for (int type = 0; type < 3; ++type) {
    for (int order : {1, 2, 5, 10}) {
      for (int subtype = 0; subtype < 2; ++subtype) {
        const double cutoff = order == 10 ? 12000 : order == 5 ? 5000 : 1000;
        cases.push_back({type, subtype, order, 48000, order == 5 ? 2 : 1, 129, 17 + order,
                         cutoff, 1.25, 35});
      }
    }
  }
  std::ofstream out(argv[1], std::ios::binary);
  if (!out) return 3;
  out.write("CLF1", 4);
  u32(out, static_cast<uint32_t>(cases.size()));
  for (const auto& item : cases) {
    u32(out, item.sampleRate); u32(out, item.channels); u32(out, item.samples); u32(out, item.splitAt);
    i32(out, item.type); i32(out, item.subtype); i32(out, item.order);
    f64(out, item.cutoff); f64(out, item.passband); f64(out, item.stopband);
    auto sections = item.type == 0
      ? Biquad::butterworth(item.order, item.sampleRate / 2.0, item.cutoff, item.subtype)
      : item.type == 1
        ? Biquad::chebyshev1(item.order, item.sampleRate / 2.0, item.cutoff, item.passband, item.subtype)
        : Biquad::chebyshev2(item.order, item.sampleRate / 2.0, item.cutoff, item.stopband, item.subtype);
    u32(out, static_cast<uint32_t>(sections.size()));
    for (const auto& section : sections) {
      for (double value : section.numer) f64(out, value);
      for (double value : section.denom) f64(out, value);
    }
    for (int channel = 0; channel < item.channels; ++channel) {
      std::vector<float> input(item.samples);
      for (int index = 0; index < item.samples; ++index) {
        input[index] = static_cast<float>(0.6 * std::sin(index * 0.07 + channel * 0.3)
          + 0.2 * std::cos(index * 0.013) + ((index % 9) - 4) * 0.025);
      }
      floats(out, input);
      std::vector<float> current = input;
      for (auto& section : sections) {
        section.prevIn = section.prevPrevIn = section.prevOut = section.prevPrevOut = 0;
      }
      for (auto& section : sections) {
        std::vector<float> next(current.size());
        for (size_t index = 0; index < current.size(); ++index) next[index] = section.processOne(current[index]);
        current = next;
      }
      floats(out, current);
    }
  }
  if (!out) return 4;
  return 0;
}
