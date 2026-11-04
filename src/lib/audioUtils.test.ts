import { describe, it, expect } from 'vitest';
import {
  formatTime,
  formatDuration,
  clamp,
  generateId,
  dbToGain,
  gainToDb,
  formatFileSize,
  resampleBuffer,
  interleaveChannels,
  deinterleaveChannels,
} from '@/lib/audioUtils';

describe('audioUtils - 格式化工具', () => {
  describe('formatTime', () => {
    it('秒格式化为 mm:ss.xxx', () => {
      expect(formatTime(0)).toBe('00:00.000');
      expect(formatTime(5.5)).toBe('00:05.500');
      expect(formatTime(65.123)).toBe('01:05.123');
      expect(formatTime(3661.5)).toBe('61:01.500');
    });

    it('处理负数', () => {
      expect(formatTime(-1)).toBe('00:00.000');
    });
  });

  describe('formatDuration', () => {
    it('小于 60 秒显示秒', () => {
      expect(formatDuration(30)).toBe('30.0 秒');
    });

    it('大于 60 秒显示分秒', () => {
      expect(formatDuration(90)).toBe('1 分 30 秒');
    });

    it('大于 1 小时显示时分秒', () => {
      expect(formatDuration(3661)).toBe('1 小时 1 分 1 秒');
    });
  });

  describe('formatFileSize', () => {
    it('小于 1KB', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('KB 范围', () => {
      expect(formatFileSize(2048)).toBe('2.0 KB');
    });

    it('MB 范围', () => {
      expect(formatFileSize(1024 * 1024 * 5)).toBe('5.0 MB');
    });
  });
});

describe('audioUtils - 数学工具', () => {
  describe('clamp', () => {
    it('值在范围内保持不变', () => {
      expect(clamp(0.5, 0, 1)).toBe(0.5);
    });

    it('小于最小值返回最小值', () => {
      expect(clamp(-1, 0, 1)).toBe(0);
    });

    it('大于最大值返回最大值', () => {
      expect(clamp(2, 0, 1)).toBe(1);
    });
  });

  describe('dbToGain / gainToDb 往返', () => {
    it('0 dB 对应 gain 1.0', () => {
      expect(dbToGain(0)).toBeCloseTo(1.0);
    });

    it('gain 1 对应 0 dB', () => {
      expect(gainToDb(1)).toBeCloseTo(0);
    });

    it('dB 和 gain 双向转换近似一致', () => {
      const db = -6;
      const gain = dbToGain(db);
      expect(gainToDb(gain)).toBeCloseTo(db, 4);
    });
  });
});

describe('audioUtils - generateId', () => {
  it('生成不重复的 ID', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });

  it('ID 是字符串', () => {
    expect(typeof generateId()).toBe('string');
    expect(generateId().length).toBeGreaterThan(0);
  });
});

describe('audioUtils - 重采样', () => {
  it('相同采样率返回副本', () => {
    const input = new Float32Array([1, 2, 3, 4]);
    const output = resampleBuffer(input, 44100, 44100);
    expect(output).not.toBe(input);
    expect(output).toEqual(input);
  });

  it('降采样后长度变小', () => {
    const input = new Float32Array(44100).fill(0.5);
    const output = resampleBuffer(input, 44100, 22050);
    expect(output.length).toBeCloseTo(22050, -1);
  });

  it('升采样后长度变大', () => {
    const input = new Float32Array(1000).fill(0.5);
    const output = resampleBuffer(input, 22050, 44100);
    expect(output.length).toBeCloseTo(2000, -1);
  });

  it('空输入返回空', () => {
    const output = resampleBuffer(new Float32Array(), 44100, 48000);
    expect(output.length).toBe(0);
  });
});

describe('audioUtils - 声道交叉/反交叉', () => {
  it('单声道交叉输出为原始序列', () => {
    const ch0 = new Float32Array([1, 2, 3]);
    const result = interleaveChannels([ch0]);
    expect(result).toEqual(new Float32Array([1, 2, 3]));
  });

  it('立体声交叉正确排列', () => {
    const left = new Float32Array([1, 2, 3]);
    const right = new Float32Array([4, 5, 6]);
    const result = interleaveChannels([left, right]);
    expect(result).toEqual(new Float32Array([1, 4, 2, 5, 3, 6]));
  });

  it('反交叉恢复原始声道', () => {
    const interleaved = new Float32Array([1, 4, 2, 5, 3, 6]);
    const channels = deinterleaveChannels(interleaved, 2);
    expect(channels.length).toBe(2);
    expect(channels[0]).toEqual(new Float32Array([1, 2, 3]));
    expect(channels[1]).toEqual(new Float32Array([4, 5, 6]));
  });

  it('交叉后反交叉往返一致', () => {
    const left = new Float32Array([0.1, 0.2, -0.3, 0.5]);
    const right = new Float32Array([-0.1, 0.3, 0.4, -0.2]);
    const interleaved = interleaveChannels([left, right]);
    const [l, r] = deinterleaveChannels(interleaved, 2);
    expect(l).toEqual(left);
    expect(r).toEqual(right);
  });
});
