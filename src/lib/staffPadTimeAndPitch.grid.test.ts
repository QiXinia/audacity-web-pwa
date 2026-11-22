import { processStaffPadTimeAndPitchChannels } from './staffPadTimeAndPitch';

describe('StaffPad deterministic extreme-parameter grid', () => {
  it('keeps short-input speed/pitch/channel combinations finite with exact output lengths', () => {
    const frames = [1, 2, 3, 7, 31, 63, 64, 65, 127];
    const timeRatios = [0.1, 0.1000001, 0.5, 1, 1.000001, 2, 10, 100];
    const pitchRatios = [0.5, 1, 2];
    let checked = 0;
    for (const frameCount of frames) {
      for (const timeRatio of timeRatios) {
        for (const pitchRatio of pitchRatios) {
          for (const sampleRate of [1000, 8000]) {
            const channelCount = checked % 2 + 1;
            const source = Array.from({ length: channelCount }, (_, channel) => (
              Float32Array.from({ length: frameCount }, (_, index) => (
                0.2 * Math.sin(index * 0.37 + channel * 0.9)
                + 0.1 * Math.cos(index * 0.11 + channel * 0.3)
              ))
            ));
            const output = processStaffPadTimeAndPitchChannels(source, {
              sampleRate,
              timeRatio,
              pitchRatio,
              preserveFormants: true,
              fftSize: 64,
            });
            const expectedFrames = Math.round(frameCount * timeRatio);
            expect(output, JSON.stringify({ frameCount, timeRatio, pitchRatio, sampleRate, channelCount })).toHaveLength(channelCount);
            for (const channel of output) {
              expect(channel, JSON.stringify({ frameCount, timeRatio, pitchRatio, sampleRate, channelCount })).toHaveLength(expectedFrames);
              expect(channel.every((sample) => Number.isFinite(sample)), JSON.stringify({ frameCount, timeRatio, pitchRatio, sampleRate, channelCount })).toBe(true);
            }
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(432);
  }, 180_000);
});
