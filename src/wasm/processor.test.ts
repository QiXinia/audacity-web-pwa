import { describe, it, expect } from 'vitest';
import { wasmProcessor } from '@/wasm/processor';

// wasmProcessor 有 JS fallback，不需要 WASM 模块加载也能跑测试
describe('WASM Audio Processor - WAV 编解码', () => {
  describe('PCM16 编码', () => {
    it('编码静音为有效 WAV 数据', () => {
      const samples = new Float32Array(1000).fill(0);
      const result = wasmProcessor.encodeWavPcm16(samples, 1, 44100);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(44);
      // 检查 RIFF 标识
      const riff = new TextDecoder().decode(result.slice(0, 4));
      expect(riff).toBe('RIFF');
      // 检查 WAVE 标识
      const wave = new TextDecoder().decode(result.slice(8, 12));
      expect(wave).toBe('WAVE');
    });

    it('编码后的文件大小与样本数匹配', () => {
      const numSamples = 44100;
      const samples = new Float32Array(numSamples).fill(0.5);
      const result = wasmProcessor.encodeWavPcm16(samples, 1, 44100);
      // PCM16 单声道: 44 (header) + numSamples * 2
      const expectedTotal = 44 + numSamples * 2;
      expect(result.length).toBe(expectedTotal);
    });

    it('立体声编码正确（交叉存储）', () => {
      // 10 个立体声采样 = 20 个交错 float (L R L R ...)
      const interleaved = new Float32Array(20);
      for (let i = 0; i < 10; i++) {
        interleaved[i * 2] = 0.5;
        interleaved[i * 2 + 1] = -0.5;
      }
      const result = wasmProcessor.encodeWavPcm16(interleaved, 2, 44100);
      expect(result).toBeInstanceOf(Uint8Array);
      // 44 header + 20 samples * 2 bytes
      expect(result.length).toBe(44 + 20 * 2);
    });
  });

  describe('Float32 编码', () => {
    it('编码为 32 位浮点 WAV', () => {
      const samples = new Float32Array(500).fill(0.3);
      const result = wasmProcessor.encodeWavFloat32(samples, 1, 44100);
      expect(result).toBeInstanceOf(Uint8Array);
      // 32-bit float: 每个样本 4 字节
      expect(result.length).toBe(44 + 500 * 4);
    });
  });

  describe('WAV 解码', () => {
    it('解码自己编码的 PCM16 WAV', () => {
      const original = new Float32Array(1000);
      for (let i = 0; i < 1000; i++) {
        original[i] = Math.sin(i / 50) * 0.5;
      }

      const encoded = wasmProcessor.encodeWavPcm16(original, 1, 44100);
      const decoded = wasmProcessor.decodeWav(encoded);

      expect(decoded).toBeDefined();
      expect(decoded.numChannels).toBe(1);
      expect(decoded.sampleRate).toBe(44100);
      expect(decoded.samples.length).toBe(1000);

      // PCM16 有量化误差，允许小偏差
      for (let i = 0; i < 1000; i++) {
        expect(Math.abs(decoded.samples[i] - original[i])).toBeLessThan(0.001);
      }
    });

    it('解码立体声 WAV 返回交错样本', () => {
      const interleaved = new Float32Array(200);
      for (let i = 0; i < 100; i++) {
        interleaved[i * 2] = 0.7;
        interleaved[i * 2 + 1] = -0.3;
      }
      const encoded = wasmProcessor.encodeWavPcm16(interleaved, 2, 44100);
      const decoded = wasmProcessor.decodeWav(encoded);
      expect(decoded.numChannels).toBe(2);
      expect(decoded.samples.length).toBe(200);
    });
  });
});

describe('WASM Audio Processor - DSP 处理 (原地修改)', () => {
  describe('normalize', () => {
    it('静音不改变，返回增益 1', () => {
      const input = new Float32Array(100).fill(0);
      const gain = wasmProcessor.normalize(input, 0); // target in dB
      expect(gain).toBe(1);
      for (let i = 0; i < 100; i++) {
        expect(input[i]).toBe(0);
      }
    });

    it('低于峰值的信号被归一化到目标 dB', () => {
      const input = new Float32Array([0.5, -0.3, 0.4]);
      const gain = wasmProcessor.normalize(input, 0); // 0 dB = 峰值 1.0
      // 最大 0.5，目标峰值 1.0，增益应为 2
      expect(gain).toBeCloseTo(2.0, 5);
      expect(input[0]).toBeCloseTo(1.0, 5);
      expect(input[1]).toBeCloseTo(-0.6, 5);
      expect(input[2]).toBeCloseTo(0.8, 5);
    });
  });

  describe('reverse', () => {
    it('原地反转', () => {
      const input = new Float32Array([1, 2, 3, 4, 5]);
      wasmProcessor.reverse(input);
      expect(input[0]).toBe(5);
      expect(input[4]).toBe(1);

      wasmProcessor.reverse(input);
      expect(input[0]).toBe(1);
      expect(input[4]).toBe(5);
    });

    it('空数组无变化', () => {
      const input = new Float32Array([]);
      wasmProcessor.reverse(input);
      expect(input.length).toBe(0);
    });
  });

  describe('applyGain', () => {
    it('增益 1 不改变', () => {
      const input = new Float32Array([0.5, -0.3, 0.1]);
      wasmProcessor.applyGain(input, 1.0);
      expect(input[0]).toBeCloseTo(0.5, 6);
      expect(input[1]).toBeCloseTo(-0.3, 6);
    });

    it('增益 2 幅度翻倍', () => {
      const input = new Float32Array([0.5, -0.3, 0.1]);
      wasmProcessor.applyGain(input, 2.0);
      expect(input[0]).toBeCloseTo(1.0, 5);
      expect(input[1]).toBeCloseTo(-0.6, 5);
    });

    it('增益 0 输出静音', () => {
      const input = new Float32Array([0.5, -0.3, 0.1]);
      wasmProcessor.applyGain(input, 0.0);
      for (const v of input) {
        expect(v).toBeCloseTo(0, 6);
      }
    });
  });

  describe('applyFadeIn', () => {
    it('从 0 渐增至原幅度', () => {
      const input = new Float32Array(100).fill(1.0);
      wasmProcessor.applyFadeIn(input, 100);
      expect(input[0]).toBeCloseTo(0, 3);
      // 第 99 个样本系数为 99/100 = 0.99
      expect(input[99]).toBeCloseTo(0.99, 2);
    });
  });

  describe('applyFadeOut', () => {
    it('从原幅度减至 0', () => {
      const input = new Float32Array(100).fill(1.0);
      wasmProcessor.applyFadeOut(input, 100);
      expect(input[0]).toBeCloseTo(1.0, 2);
      // 最后一个样本系数为 1/100 = 0.01，不是精确 0
      expect(input[99]).toBeCloseTo(0.01, 2);
    });
  });

  describe('invertPhase', () => {
    it('翻转相位', () => {
      const input = new Float32Array([0.5, -0.3, 1.0, 0]);
      wasmProcessor.invertPhase(input);
      expect(input[0]).toBeCloseTo(-0.5, 6);
      expect(input[1]).toBeCloseTo(0.3, 6);
      expect(input[2]).toBeCloseTo(-1.0, 6);
      expect(input[3]).toBeCloseTo(0, 6);
    });
  });

  describe('computePeak', () => {
    it('计算峰值', () => {
      const input = new Float32Array([0.3, -0.5, 0.1, -0.2]);
      const peak = wasmProcessor.computePeak(input);
      expect(peak).toBeCloseTo(0.5, 6);
    });

    it('空数组返回 0', () => {
      expect(wasmProcessor.computePeak(new Float32Array())).toBe(0);
    });
  });

  describe('computeRms', () => {
    it('静音 RMS 为 0', () => {
      expect(wasmProcessor.computeRms(new Float32Array(100).fill(0))).toBe(0);
    });

    it('全 1 信号 RMS 为 1', () => {
      expect(wasmProcessor.computeRms(new Float32Array(100).fill(1))).toBeCloseTo(1.0, 6);
    });
  });
});

describe('WASM Audio Processor - 缓冲区工具', () => {
  describe('concatBuffers', () => {
    it('连接两个缓冲区', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([4, 5]);
      const result = wasmProcessor.concatBuffers(a, b);
      expect(result.length).toBe(5);
      expect(result[0]).toBe(1);
      expect(result[3]).toBe(4);
      expect(result[4]).toBe(5);
    });
  });

  describe('sliceBuffer', () => {
    it('切片正确', () => {
      const input = new Float32Array([0, 1, 2, 3, 4]);
      const result = wasmProcessor.sliceBuffer(input, 1, 4);
      expect(result.length).toBe(3);
      expect(result[0]).toBe(1);
      expect(result[2]).toBe(3);
    });

    it('边界裁剪', () => {
      const input = new Float32Array([0, 1, 2]);
      const result = wasmProcessor.sliceBuffer(input, -1, 10);
      expect(result.length).toBe(3);
    });
  });

  describe('mixBuffers', () => {
    it('等长缓冲叠加', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([0.5, -0.5, 0]);
      const result = wasmProcessor.mixBuffers(a, b);
      expect(result.length).toBe(3);
      expect(result[0]).toBeCloseTo(1.5, 5);
      expect(result[1]).toBeCloseTo(1.5, 5);
      expect(result[2]).toBeCloseTo(3.0, 5);
    });
  });
});
