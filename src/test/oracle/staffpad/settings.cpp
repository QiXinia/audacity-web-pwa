// Deterministic no-override settings for the standalone native oracle.
#include "TimeAndPitchExperimentalSettings.h"
namespace TimeAndPitchExperimentalSettings {
std::string GetLogDir() { return {}; }
std::optional<int> GetLogSample(int) { return {}; }
std::optional<double> GetCutoffQuefrencyOverride() { return {}; }
std::optional<int> GetFftSizeOverride() { return {}; }
std::optional<bool> GetReduceImagingOverride() { return {}; }
}
